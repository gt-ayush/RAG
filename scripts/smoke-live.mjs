import {
  chunkDocument,
  generateGroundedAnswer,
  HttpEmbeddingProvider,
  HttpLLMProvider,
  QdrantStore,
  retrieve,
} from '../dist/index.js';

/**
 * Source-of-truth keywords: smoke test, live providers, paid API, opt-in,
 * end-to-end pipeline, env credentials
 */

const REQUIRED_ENV_VARS = [
  'EMBEDDING_BASE_URL',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
  'LLM_BASE_URL',
  'LLM_MODEL',
  'VECTOR_DB_URL',
];

const SAMPLE_DOCUMENTS = [
  {
    id: 'smoke-doc-1',
    content: 'Employees are allowed to work remotely on Fridays with manager approval.',
    source: 'smoke-handbook',
  },
  {
    id: 'smoke-doc-2',
    content: 'The maximum password age for corporate accounts is 90 days.',
    source: 'smoke-policy',
  },
  {
    id: 'smoke-doc-3',
    content: 'Expense reports must be submitted within 30 days of the expense date.',
    source: 'smoke-policy',
  },
];

const SAMPLE_QUERIES = [
  { query: 'Can employees work remotely on Fridays?', expectedSource: 'smoke-handbook' },
  { query: 'What is the maximum password age?', expectedSource: 'smoke-policy' },
  { query: 'How long do I have to submit expense reports?', expectedSource: 'smoke-policy' },
];

function parseArgs(argv) {
  let force = false;
  for (const arg of argv) {
    if (arg === '--force' || arg === '--force=true') force = true;
    else if (arg === '--no-force' || arg === '--force=false') force = false;
  }
  return { force };
}

function requireEnv(vars) {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. Set them before running the live smoke test.`,
    );
  }
}

function checkForce(flag) {
  const envForce = process.env.SMOKE_LIVE_FORCE === '1' || process.env.SMOKE_LIVE_FORCE === 'true';
  if (!flag && !envForce) {
    console.error(
      'ERROR: Live smoke test requires explicit confirmation to avoid unintended paid API usage.\n' +
        'Run with --force or set SMOKE_LIVE_FORCE=1 to confirm.\n' +
        'This script calls real embedding/LLM/vector store endpoints and may incur costs.',
    );
    process.exit(1);
  }
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const { force } = parseArgs(process.argv.slice(2));
  checkForce(force);
  requireEnv(REQUIRED_ENV_VARS);

  const embeddingBaseUrl = process.env.EMBEDDING_BASE_URL;
  const embeddingModel = process.env.EMBEDDING_MODEL;
  const embeddingDimensions = Number(process.env.EMBEDDING_DIMENSIONS);
  const embeddingApiKey = process.env.EMBEDDING_API_KEY;
  const embeddingTimeoutMs = process.env.EMBEDDING_TIMEOUT_MS
    ? Number(process.env.EMBEDDING_TIMEOUT_MS)
    : undefined;

  const llmBaseUrl = process.env.LLM_BASE_URL;
  const llmModel = process.env.LLM_MODEL;
  const llmApiKey = process.env.LLM_API_KEY;
  const llmTimeoutMs = process.env.LLM_TIMEOUT_MS
    ? Number(process.env.LLM_TIMEOUT_MS)
    : undefined;

  const vectorDbUrl = process.env.VECTOR_DB_URL;
  const vectorDbApiKey = process.env.VECTOR_DB_API_KEY;

  console.error('Live smoke test starting against real providers...');
  console.error(
    `  embedding: ${embeddingModel} @ ${embeddingBaseUrl} (${embeddingDimensions} dims)`,
  );
  console.error(`  LLM: ${llmModel} @ ${llmBaseUrl}`);
  console.error(`  vector DB: ${vectorDbUrl}`);

  const embeddingProvider = new HttpEmbeddingProvider({
    baseUrl: embeddingBaseUrl,
    model: embeddingModel,
    dimensions: embeddingDimensions,
    ...(embeddingApiKey ? { apiKey: embeddingApiKey } : {}),
    ...(embeddingTimeoutMs ? { timeoutMs: embeddingTimeoutMs } : {}),
  });

  const languageModel = new HttpLLMProvider({
    baseUrl: llmBaseUrl,
    model: llmModel,
    ...(llmApiKey ? { apiKey: llmApiKey } : {}),
    ...(llmTimeoutMs ? { timeoutMs: llmTimeoutMs } : {}),
  });

  const store = new QdrantStore({
    url: vectorDbUrl,
    ...(vectorDbApiKey ? { apiKey: vectorDbApiKey } : {}),
    collection: 'smoke-live',
    dimensions: embeddingDimensions,
  });

  // Ingest sample documents
  const ingestStart = performance.now();
  const allChunks = [];
  let ingestedChunks = 0;
  let ingestFailures = 0;

  for (const doc of SAMPLE_DOCUMENTS) {
    const parsed = chunkDocument(
      { id: doc.id, content: doc.content, metadata: { documentId: doc.id, source: doc.source } },
      { chunkSize: 200, chunkOverlap: 0 },
    );
    if (!parsed.ok) {
      ingestFailures += 1;
      continue;
    }
    const chunks = parsed.value;
    const embedRes = await embeddingProvider.embedChunks(chunks, 'document');
    if (!Array.isArray(embedRes)) {
      ingestFailures += 1;
      continue;
    }
    for (let i = 0; i < chunks.length; i += 1) {
      allChunks.push({ chunk: chunks[i], embedding: embedRes[i] });
    }
    ingestedChunks += chunks.length;
  }

  const upsertRes = await store.upsert(
    allChunks.map((c) => ({ chunk: c.chunk, embedding: c.embedding })),
  );
  if (!upsertRes.ok) {
    throw new Error(`Qdrant upsert failed: ${JSON.stringify(upsertRes.issues)}`);
  }
  const ingestMs = performance.now() - ingestStart;

  // Run sample queries
  const queryResults = [];

  let totalQueries = 0;
  let passedQueries = 0;
  let failures = 0;

  for (const q of SAMPLE_QUERIES) {
    totalQueries += 1;
    const t0 = performance.now();
    const retrieved = await retrieve(
      { text: q.query, topK: 3 },
      { embeddingProvider, vectorStore: store },
    );
    const retrievalMs = performance.now() - t0;

    if (!retrieved.ok || retrieved.value.length === 0) {
      failures += 1;
      queryResults.push({
        query: q.query,
        expectedSource: q.expectedSource,
        retrievedSource: null,
        answer: '',
        insufficientContext: true,
        retrievalMs,
        generationMs: 0,
        ok: false,
      });
      continue;
    }

    const retrievedSource = retrieved.value[0]?.chunk.metadata.source ?? null;
    const t1 = performance.now();
    const generated = await generateGroundedAnswer(
      { query: q.query, context: retrieved.value },
      { model: languageModel, expectedModel: llmModel },
    );
    const generationMs = performance.now() - t1;

    const ok = generated.ok && !generated.value.insufficientContext && retrievedSource === q.expectedSource;
    if (ok) passedQueries += 1;
    else failures += 1;

    queryResults.push({
      query: q.query,
      expectedSource: q.expectedSource,
      retrievedSource,
      answer: generated.ok ? generated.value.text : '',
      insufficientContext: generated.ok ? !!generated.value.insufficientContext : true,
      retrievalMs,
      generationMs,
      ok,
    });
  }

  const queryMs = performance.now() - ingestStart - ingestMs;

  const result = {
    measuredAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      providers: {
        embedding: { model: embeddingModel, baseUrl: embeddingBaseUrl, dimensions: embeddingDimensions },
        llm: { model: llmModel, baseUrl: llmBaseUrl },
        vectorDb: { url: vectorDbUrl },
      },
    },
    workload: {
      mode: 'live end-to-end smoke (real providers)',
      documents: SAMPLE_DOCUMENTS.length,
      chunksIngested: ingestedChunks,
      queries: totalQueries,
      collection: 'smoke-live',
    },
    latencyMs: {
      ingestion: { totalMs: ingestMs, samples: 1 },
      queries: {
        retrieval: {
          p50: percentile(queryResults.map((r) => r.retrievalMs), 50),
          p95: percentile(queryResults.map((r) => r.retrievalMs), 95),
          p99: percentile(queryResults.map((r) => r.retrievalMs), 99),
          samples: queryResults.length,
        },
        generation: {
          p50: percentile(queryResults.map((r) => r.generationMs), 50),
          p95: percentile(queryResults.map((r) => r.generationMs), 95),
          p99: percentile(queryResults.map((r) => r.generationMs), 99),
          samples: queryResults.length,
        },
      },
    },
    correctness: {
      totalQueries,
      passedQueries,
      failures,
      passRate: totalQueries ? passedQueries / totalQueries : 0,
    },
    failures: { count: failures + ingestFailures, rate: totalQueries ? failures / totalQueries : 0 },
    cost: {
      measured: false,
      reason: 'real providers may incur paid usage; caller is responsible for quota and cost',
    },
    limitations: [
      'Uses real embedding/LLM/vector store providers; may consume paid quota.',
      'Small synthetic dataset (3 documents, 3 queries); not representative of production scale.',
      'Results depend on provider availability, latency, and model behavior.',
    ],
    queryResults,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`Live smoke test failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
