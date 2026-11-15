import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { chunkDocument } from '../src/ingest.js';
import { MemoryVectorStore } from '../src/memory-store.js';
import { retrieve } from '../src/retrieve.js';
import { generateGroundedAnswer } from '../src/generate.js';
import {
  aggregateRetrievalMetrics,
  loadGoldenDataset,
  recallAtK,
  reciprocalRank,
  retrievedSourceIds,
  type CaseRetrievalMetrics,
} from '../src/eval.js';
import type { Document, Embedding } from '../src/types.js';

const DATASET = path.resolve('data/eval/golden-v0.2.0.json');

function simpleEmbedding(text: string, dimensions = 8): number[] {
  const v = new Array(dimensions).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const t of tokens) {
    let h = 0;
    for (let i = 0; i < t.length; i += 1) h = (h * 31 + t.charCodeAt(i)) | 0;
    const idx = Math.abs(h) % dimensions;
    v[idx] += 1;
  }
  return v;
}

const provider = {
  model: 'mock-embed-v1',
  dimensions: 8,
  async embedTexts(texts: readonly string[], _purpose: 'document' | 'query'): Promise<readonly Embedding[]> {
    return texts.map((text, i) => ({
      chunkId: `q-${i}`,
      model: 'mock-embed-v1',
      dimensions: 8,
      vector: simpleEmbedding(text, 8),
    }));
  },
};

const model = {
  model: 'mock-lm-v1',
  async generate(prompt: { evidence: string; user: string }) {
    if (prompt.evidence.includes('[No retrieved evidence]')) {
      return { text: '', insufficientContext: true };
    }
    if (prompt.user.toLowerCase().includes('remote work')) {
      return { text: 'Remote work is allowed on Fridays.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('password age')) {
      return { text: 'The maximum password age is 90 days.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('password') && prompt.user.toLowerCase().includes('characters')) {
      return { text: 'Passwords must be at least 12 characters.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('vacation accrual')) {
      return { text: 'Employees accrue 1.5 vacation days per month.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('unused vacation')) {
      return { text: 'Unused vacation carries over up to 5 days per year.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('mfa') || prompt.user.toLowerCase().includes('vpn access')) {
      return { text: 'MFA is required for VPN access.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('notify') || prompt.user.toLowerCase().includes('manager')) {
      return { text: 'Employees must notify their manager in advance.', citedChunkIds: [] };
    }
    if (prompt.user.toLowerCase().includes('dress code')) {
      return { text: 'Insufficient retrieved evidence to answer the question.', insufficientContext: true };
    }
    return { text: 'Insufficient retrieved evidence to answer the question.', insufficientContext: true };
  },
};

describe('representative smoke evaluation (measured, synthetic baseline)', () => {
  it('runs retrieval and generation separately and computes retrieval metrics with deltas', async () => {
    const dataset = await loadGoldenDataset(DATASET);
    expect(dataset.version).toBe('0.2.0');
    expect(dataset.cases.length).toBe(10);

    const retrievalCases: CaseRetrievalMetrics[] = [];
    let insufficientGenerationCases = 0;

    for (const c of dataset.cases) {
      const store = new MemoryVectorStore(8);
      for (const doc of c.documents) {
        const document: Document = {
          id: doc.id,
          content: doc.content,
          metadata: {
            documentId: doc.id,
            source: doc.source,
            attributes: { goldenDocumentId: doc.id },
          },
        };
        const chunksRes = chunkDocument(document, { chunkSize: 200, chunkOverlap: 0 });
        expect(chunksRes.ok).toBe(true);
        if (!chunksRes.ok) continue;
        const embeddings = chunksRes.value.map((chunk) => ({
          chunkId: chunk.id,
          model: 'mock-embed-v1',
          dimensions: 8,
          vector: simpleEmbedding(chunk.content, 8),
        }));
        await store.upsert(chunksRes.value.map((chunk, i) => ({ chunk, embedding: embeddings[i]! })));
      }

      const retrieved = await retrieve({ text: c.query, topK: 3 }, { embeddingProvider: provider, vectorStore: store });
      expect(retrieved.ok).toBe(true);
      const results = retrieved.ok ? retrieved.value : [];
      const ids = retrievedSourceIds(results);

      retrievalCases.push({
        caseId: c.id,
        recallAtK: recallAtK(ids, c.relevantDocumentIds, 3),
        reciprocalRank: reciprocalRank(ids, c.relevantDocumentIds),
        retrievedSourceIds: ids,
      });

      const generated = await generateGroundedAnswer({ query: c.query, context: results }, { model });
      expect(generated.ok).toBe(true);
      if (generated.ok && generated.value.insufficientContext) insufficientGenerationCases += 1;
    }

    const aggregate = aggregateRetrievalMetrics(retrievalCases);
    // Measured on synthetic smoke set v0.2.0 with deterministic mock embedder/model.
    expect(aggregate.sampleSize).toBe(10);
    expect(aggregate.recallAtK).toBe(1);
    expect(aggregate.mrr).toBe(1);
    expect(insufficientGenerationCases).toBe(2);

    // Report deltas vs previous version v0.1.0 for regression/delta tracking.
    const previous = { sampleSize: 3, recallAtK: 1, mrr: 1 };
    const delta = {
      sampleSizeDelta: aggregate.sampleSize - previous.sampleSize,
      recallAtKDelta: aggregate.recallAtK - previous.recallAtK,
      mrrDelta: aggregate.mrr - previous.mrr,
    };
    expect(delta.sampleSizeDelta).toBe(7);
    expect(delta.recallAtKDelta).toBe(0);
    expect(delta.mrrDelta).toBe(0);

    console.log(JSON.stringify({
      dataset: { path: DATASET, version: '0.2.0', sampleSize: aggregate.sampleSize },
      method: 'synthetic smoke eval; deterministic mock embeddings/model; chunkSize=200 overlap=0; topK=3; separate retrieval+generation passes',
      retrieval: aggregate,
      generation: { insufficientContextCases: insufficientGenerationCases },
      delta,
      limitations: 'tiny synthetic baseline; not production/quality evidence',
    }));
  });
});
