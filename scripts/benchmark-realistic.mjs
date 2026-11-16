import { performance } from 'node:perf_hooks';
import { cpus, totalmem, freemem, platform, arch, version as nodeVersion } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HttpEmbeddingProvider,
  HttpLLMProvider,
  QdrantStore,
  MemoryVectorStore,
  chunkDocument,
  retrieve,
  generateGroundedAnswer,
  loadGoldenDataset,
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.resolve(__dirname, '../data/eval/golden-v0.2.0.json');

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdDev(values) {
  if (values.length === 0) return 0;
  const m = mean(values);
  const sq = values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
  return Math.sqrt(sq);
}

function isMockUrl(url) {
  if (!url) return true;
  try {
    const u = new URL(url);
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === 'example.com' || u.hostname === 'api.example.com';
  } catch {
    return true;
  }
}

function redactApiKey(value) {
  if (!value || typeof value !== 'string') return value;
  return value.length <= 4 ? '[REDACTED]' : value.slice(0, 4) + '…[REDACTED]';
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runConcurrent(fn, concurrency, count) {
  const results = [];
  const errors = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= count) break;
      try {
        const start = performance.now();
        await fn(i);
        const elapsed = performance.now() - start;
        results.push(elapsed);
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results, errors };
}

function buildEnvSnapshot() {
  const env = process.env;
  return {
    nodeVersion: process.version,
    platform,
    arch,
    cpus: cpus().length,
    totalMemMB: Math.round(totalmem() / 1024 / 1024),
    freeMemMB: Math.round(freemem() / 1024 / 1024),
    env: {
      EMBEDDING_BASE_URL: env.EMBEDDING_BASE_URL ? redactApiKey(env.EMBEDDING_BASE_URL) : undefined,
      EMBEDDING_DIMENSIONS: env.EMBEDDING_DIMENSIONS,
      EMBEDDING_TIMEOUT_MS: env.EMBEDDING_TIMEOUT_MS,
      LLM_BASE_URL: env.LLM_BASE_URL ? redactApiKey(env.LLM_BASE_URL) : undefined,
      LLM_TIMEOUT_MS: env.LLM_TIMEOUT_MS,
      VECTOR_DB_URL: env.VECTOR_DB_URL ? redactApiKey(env.VECTOR_DB_URL) : undefined,
      QDRANT_COLLECTION: env.QDRANT_COLLECTION,
      NODE_ENV: env.NODE_ENV,
    },
  };
}

async function main() {
  const iterations = parseInt(process.env.BENCH_ITERATIONS || '10', 10);
  const concurrency = parseInt(process.env.BENCH_CONCURRENCY || '1', 10);
  const topK = parseInt(process.env.BENCH_TOPK || '3', 10);
  const chunkSize = parseInt(process.env.BENCH_CHUNK_SIZE || '200', 10);
  const chunkOverlap = parseInt(process.env.BENCH_CHUNK_OVERLAP || '0', 10);

  const envSnapshot = buildEnvSnapshot();

  // Determine if real providers are configured
  const hasEmbeddingProvider = !!envSnapshot.env.EMBEDDING_BASE_URL && !isMockUrl(envSnapshot.env.EMBEDDING_BASE_URL);
  const hasVectorStore = !!envSnapshot.env.VECTOR_DB_URL && !isMockUrl(envSnapshot.env.VECTOR_DB_URL);
  const hasLLMProvider = !!envSnapshot.env.LLM_BASE_URL && !isMockUrl(envSnapshot.env.LLM_BASE_URL);
  const usingRealProviders = hasEmbeddingProvider && hasVectorStore && hasLLMProvider;

  console.log(`Phase 14.1 — Realistic Workload Baseline`);
  console.log(`============================================`);
  console.log(`Environment: ${JSON.stringify(envSnapshot, null, 2)}`);
  console.log(`Real providers configured: embedding=${hasEmbeddingProvider}, vectorStore=${hasVectorStore}, llm=${hasLLMProvider}`);
  console.log(`Workload: iterations=${iterations}, concurrency=${concurrency}, topK=${topK}, chunkSize=${chunkSize}, chunkOverlap=${chunkOverlap}`);
  console.log(`Using real providers: ${usingRealProviders}`);
  console.log('');

  const dataset = await loadGoldenDataset(DATASET);

  // Determine embedding dimensions
  const embeddingDimensions = parseInt(process.env.EMBEDDING_DIMENSIONS || '8', 10);

  // Build embedding provider
  let embeddingProvider;
  if (hasEmbeddingProvider) {
    embeddingProvider = new HttpEmbeddingProvider({
      baseUrl: process.env.EMBEDDING_BASE_URL,
      model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
      dimensions: embeddingDimensions,
      apiKey: process.env.EMBEDDING_API_KEY,
      timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10),
    });
  } else {
    // Fallback to deterministic mock embedder (same as smoke benchmark)
    function simpleEmbedding(text, dimensions = 8) {
      const v = new Array(dimensions).fill(0);
      const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      for (const t of tokens) {
        let h = 0;
        for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
        v[Math.abs(h) % dimensions] += 1;
      }
      return v;
    }
    embeddingProvider = {
      model: 'mock-embed-v1',
      dimensions: 8,
      async embedTexts(texts) {
        return texts.map((text, i) => ({ chunkId: `q-${i}`, model: 'mock-embed-v1', dimensions: 8, vector: simpleEmbedding(text, 8) }));
      },
      async embedChunks(chunks) {
        return chunks.map((chunk) => ({ chunkId: chunk.id, model: 'mock-embed-v1', dimensions: 8, vector: simpleEmbedding(chunk.content, 8) }));
      },
    };
  }

  // Build vector store
  let vectorStore;
  if (hasVectorStore) {
    vectorStore = new QdrantStore({
      url: process.env.VECTOR_DB_URL,
      apiKey: process.env.VECTOR_DB_API_KEY,
      collection: process.env.QDRANT_COLLECTION || 'rag-baseline',
      dimensions: embeddingDimensions,
      timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS || '30000', 10),
    });
  } else {
    vectorStore = new MemoryVectorStore(embeddingDimensions);
  }

  // Build LLM provider
  let llmProvider;
  if (hasLLMProvider) {
    llmProvider = new HttpLLMProvider({
      baseUrl: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      apiKey: process.env.LLM_API_KEY,
      timeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || '30000', 10),
    });
  } else {
    llmProvider = {
      model: 'mock-lm-v1',
      async generate(prompt) {
        if (prompt.evidence.includes('[No retrieved evidence]')) return { text: '', insufficientContext: true };
        if (prompt.user.toLowerCase().includes('remote work')) return { text: 'Remote work is allowed on Fridays.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('password age')) return { text: 'The maximum password age is 90 days.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('vacation accrual')) return { text: 'Employees accrue 1.5 vacation days per month.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('unused vacation')) return { text: 'Unused vacation carries over up to 5 days per year.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('mfa') || prompt.user.toLowerCase().includes('vpn access')) return { text: 'MFA is required for VPN access.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('notify') || prompt.user.toLowerCase().includes('manager')) return { text: 'Employees must notify their manager in advance.', citedChunkIds: [] };
        if (prompt.user.toLowerCase().includes('dress code')) return { text: 'Insufficient retrieved evidence to answer the question.', insufficientContext: true };
        return { text: 'Insufficient retrieved evidence to answer the question.', insufficientContext: true };
      },
    };
  }

  // Pre-embed and upsert all documents once (ingestion phase)
  const ingestStart = performance.now();
  const allChunks = [];
  for (const c of dataset.cases) {
    for (const doc of c.documents) {
      const document = { id: doc.id, content: doc.content, metadata: { documentId: doc.id, source: doc.source, attributes: { goldenDocumentId: doc.id } } };
      const chunksRes = chunkDocument(document, { chunkSize, chunkOverlap });
      if (!chunksRes.ok) throw new Error(`Chunking failed for ${doc.id}: ${JSON.stringify(chunksRes.issues)}`);
      allChunks.push(...chunksRes.value);
    }
  }

  const embeddings = await embeddingProvider.embedChunks(allChunks, 'document');
  const embeddingsByChunkId = new Map();
  for (let i = 0; i < allChunks.length; i += 1) {
    embeddingsByChunkId.set(allChunks[i].id, embeddings[i]);
  }

  const indexRecords = allChunks.map((chunk) => ({
    chunk,
    embedding: embeddingsByChunkId.get(chunk.id),
  }));

  const upsertResult = await vectorStore.upsert(indexRecords);
  if (!upsertResult.ok) throw new Error(`Upsert failed: ${JSON.stringify(upsertResult.issues)}`);
  const ingestMs = performance.now() - ingestStart;
  console.log(`Ingestion: ${allChunks.length} chunks upserted in ${ingestMs.toFixed(2)}ms`);

  // Define the query operation
  async function runQuery(queryText) {
    const t0 = performance.now();
    const retrieved = await retrieve(
      { text: queryText, topK },
      { embeddingProvider, vectorStore },
    );
    const retrievalMs = performance.now() - t0;
    if (!retrieved.ok) throw new Error(`Retrieval failed: ${JSON.stringify(retrieved.issues)}`);

    const t1 = performance.now();
    const generated = await generateGroundedAnswer({ query: queryText, context: retrieved.value }, { model: llmProvider });
    const generationMs = performance.now() - t1;
    if (!generated.ok) throw new Error(`Generation failed: ${JSON.stringify(generated.issues)}`);

    return { retrievalMs, generationMs };
  }

  // Warm-up: run one query to ensure connections/collections are ready
  console.log('Warming up...');
  await runQuery(dataset.cases[0].query);

  // Main benchmark: run iterations with concurrency
  console.log(`Running ${iterations} iterations with concurrency ${concurrency}...`);
  const allRetrieval = [];
  const allGeneration = [];
  let totalFailures = 0;
  let totalQueries = 0;

  const wallStart = performance.now();
  for (let iter = 0; iter < iterations; iter += 1) {
    const { results: retrievalResults, errors: retrievalErrors } = await runConcurrent(
      (i) => {
        const c = dataset.cases[i % dataset.cases.length];
        return runQuery(c.query).then((r) => {
          allRetrieval.push(r.retrievalMs);
          allGeneration.push(r.generationMs);
          totalQueries += 1;
        });
      },
      concurrency,
      dataset.cases.length,
    );

    totalFailures += retrievalErrors.length;
  }
  const wallMs = performance.now() - wallStart;

  const result = {
    measuredAt: new Date().toISOString(),
    environment: envSnapshot,
    phase: '14.1 Realistic Workload Baseline',
    usingRealProviders,
    workload: {
      iterations,
      concurrency,
      topK,
      chunkSize,
      chunkOverlap,
      dataset: { path: DATASET, version: dataset.version, cases: dataset.cases.length },
      mode: `concurrent in-process ${usingRealProviders ? 'real providers' : 'deterministic mocks'}`,
      components: ['chunk', 'embed', 'upsert-memory-or-qdrant', 'retrieve', 'generate'],
    },
    ingestion: {
      chunks: allChunks.length,
      upserted: upsertResult.value.upserted,
      latencyMs: ingestMs,
    },
    latencyMs: {
      retrieval: {
        p50: percentile(allRetrieval, 50),
        p95: percentile(allRetrieval, 95),
        p99: percentile(allRetrieval, 99),
        mean: mean(allRetrieval),
        stdDev: stdDev(allRetrieval),
        min: Math.min(...allRetrieval),
        max: Math.max(...allRetrieval),
        samples: allRetrieval.length,
      },
      generation: {
        p50: percentile(allGeneration, 50),
        p95: percentile(allGeneration, 95),
        p99: percentile(allGeneration, 99),
        mean: mean(allGeneration),
        stdDev: stdDev(allGeneration),
        min: Math.min(...allGeneration),
        max: Math.max(...allGeneration),
        samples: allGeneration.length,
      },
    },
    throughput: {
      approxQueriesPerSecond: totalQueries / (wallMs / 1000),
      wallMs,
      queries: totalQueries,
    },
    failures: { count: totalFailures, rate: totalQueries ? totalFailures / totalQueries : 0 },
    cost: { measured: false, reason: 'no external paid providers/services used (deterministic local mocks unless real endpoints configured)' },
    sloTargets: {
      retrievalP95Ms: 800,
      generationP95Ms: 800,
      maxFailureRate: 0,
      uptimeTarget: 99.9,
    },
    sloEvaluation: {
      retrievalP95UnderTarget: percentile(allRetrieval, 95) < 800,
      generationP95UnderTarget: percentile(allGeneration, 95) < 800,
      zeroFailures: totalFailures === 0,
      allSlosMet: false,
    },
    limitations: usingRealProviders
      ? [
          'Measured against configured real provider endpoints.',
          'Results are environment-sensitive; repeat in target deployment environment.',
          'Cost per query not measured; depends on provider pricing and usage.',
        ]
      : [
          'Local in-memory micro-benchmark with deterministic mocks; not representative of real provider/network/storage latency, throughput, or failure modes.',
          'Real provider endpoints not configured (set EMBEDDING_BASE_URL, VECTOR_DB_URL, LLM_BASE_URL to measure against real services).',
          'Not evidence of production SLOs, scalability, availability, or cost.',
          'SLO thresholds below are illustrative targets, not certified production guarantees.',
        ],
  };

  result.sloEvaluation.allSlosMet =
    result.sloEvaluation.retrievalP95UnderTarget &&
    result.sloEvaluation.generationP95UnderTarget &&
    result.sloEvaluation.zeroFailures;

  console.log(JSON.stringify(result, null, 2));
  return result;
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
