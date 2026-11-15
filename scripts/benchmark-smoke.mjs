import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MemoryVectorStore,
  chunkDocument,
  retrieve,
  generateGroundedAnswer,
  loadGoldenDataset,
} from '../dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATASET = path.resolve(__dirname, '../data/eval/golden-v0.1.0.json');

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

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

const provider = {
  model: 'mock-embed-v1',
  dimensions: 8,
  async embedTexts(texts) {
    return texts.map((text, i) => ({ chunkId: `q-${i}`, model: 'mock-embed-v1', dimensions: 8, vector: simpleEmbedding(text, 8) }));
  },
};
const model = {
  model: 'mock-lm-v1',
  async generate(prompt) {
    if (prompt.evidence.includes('[No retrieved evidence]')) return { text: '', insufficientContext: true };
    if (prompt.user.toLowerCase().includes('remote work')) return { text: 'Remote work is allowed on Fridays.', citedChunkIds: [] };
    if (prompt.user.toLowerCase().includes('password age')) return { text: 'The maximum password age is 90 days.', citedChunkIds: [] };
    return { text: 'Insufficient retrieved evidence to answer the question.', insufficientContext: true };
  },
};

async function runOnce(dataset) {
  let failures = 0;
  const retrievalMs = [];
  const generationMs = [];
  for (const c of dataset.cases) {
    const store = new MemoryVectorStore(8);
    for (const doc of c.documents) {
      const document = { id: doc.id, content: doc.content, metadata: { documentId: doc.id, source: doc.source, attributes: { goldenDocumentId: doc.id } } };
      const chunksRes = chunkDocument(document, { chunkSize: 200, chunkOverlap: 0 });
      if (!chunksRes.ok) { failures += 1; continue; }
      const embeddings = chunksRes.value.map((chunk) => ({ chunkId: chunk.id, model: 'mock-embed-v1', dimensions: 8, vector: simpleEmbedding(chunk.content, 8) }));
      await store.upsert(chunksRes.value.map((chunk, i) => ({ chunk, embedding: embeddings[i] })));
    }
    const t0 = performance.now();
    const retrieved = await retrieve({ text: c.query, topK: 3 }, { embeddingProvider: provider, vectorStore: store });
    retrievalMs.push(performance.now() - t0);
    if (!retrieved.ok) { failures += 1; continue; }
    const t1 = performance.now();
    const generated = await generateGroundedAnswer({ query: c.query, context: retrieved.value }, { model });
    generationMs.push(performance.now() - t1);
    if (!generated.ok) failures += 1;
  }
  return { retrievalMs, generationMs, failures, queries: dataset.cases.length };
}

const iterations = 50;
const dataset = await loadGoldenDataset(DATASET);
const allRetrieval = [];
const allGeneration = [];
let totalFailures = 0;
let totalQueries = 0;
const wallStart = performance.now();
for (let i = 0; i < iterations; i += 1) {
  const r = await runOnce(dataset);
  allRetrieval.push(...r.retrievalMs);
  allGeneration.push(...r.generationMs);
  totalFailures += r.failures;
  totalQueries += r.queries;
}
const wallMs = performance.now() - wallStart;

const result = {
  measuredAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  dataset: { path: 'data/eval/golden-v0.1.0.json', version: dataset.version, cases: dataset.cases.length },
  workload: { iterations, totalQueries, mode: 'sequential in-process smoke', components: ['chunk', 'embed-mock', 'upsert-memory', 'retrieve', 'generate-mock'] },
  latencyMs: {
    retrieval: { p50: percentile(allRetrieval, 50), p95: percentile(allRetrieval, 95), p99: percentile(allRetrieval, 99), samples: allRetrieval.length },
    generation: { p50: percentile(allGeneration, 50), p95: percentile(allGeneration, 95), p99: percentile(allGeneration, 99), samples: allGeneration.length },
  },
  throughput: { approxQueriesPerSecond: totalQueries / (wallMs / 1000), wallMs },
  failures: { count: totalFailures, rate: totalQueries ? totalFailures / totalQueries : 0 },
  cost: { measured: false, reason: 'no external paid providers/services used (deterministic local mocks)' },
  limitations: [
    'Local in-memory micro-benchmark on tiny synthetic dataset (n=3 cases) with deterministic mocks; not representative of real embedding/LLM/network/storage latency, throughput, or failure modes.',
    'Sequential single-process run; no concurrency/load, no external vector DB/provider, no multi-tenant production traffic.',
    'Not evidence of production SLOs, scalability, availability, or cost.'
  ],
};
console.log(JSON.stringify(result, null, 2));
