import { describe, expect, it, vi } from 'vitest';
import { MemoryVectorStore } from '../src/memory-store.js';
import { retrieve } from '../src/retrieve.js';
import { buildGroundedPrompt, generateGroundedAnswer } from '../src/generate.js';
import type {
  Chunk,
  Embedding,
  RetrievalAuthorization,
  RetrievalResult,
} from '../src/types.js';

/**
 * Source-of-truth keywords: red-team, cross-tenant, privilege escalation,
 * prompt injection, secret leakage, fail-closed, adversarial
 */

/** Helper to make a chunk with tenant scoping. */
function makeChunk(
  id: string,
  docId: string,
  tenantId: string,
  content: string,
): Chunk {
  return {
    id,
    documentId: docId,
    content,
    index: 0,
    metadata: {
      documentId: docId,
      source: `${docId}.txt`,
      chunkId: id,
      chunkIndex: 0,
      tenantId,
    },
  };
}

function makeEmbedding(id: string, vector: number[]): Embedding {
  return {
    chunkId: id,
    model: 'test-embed',
    dimensions: vector.length,
    vector,
  };
}

function makeRetrievalResult(
  chunk: Chunk,
  score: number,
  rank = 0,
): RetrievalResult {
  return { chunk, score, rank, sourceId: chunk.documentId };
}

const provider = {
  model: 'test-embed',
  dimensions: 2,
  embedTexts: vi.fn(async () =>
    Array.from({ length: 2 }, (_, i) => ({
      chunkId: `q-${i}`,
      model: 'test-embed',
      dimensions: 2,
      vector: [1, 0],
    })),
  ),
};

function makeAuthz(tenantId: string): RetrievalAuthorization {
  return {
    context: { tenantId },
  };
}

describe('red-team: cross-tenant access and privilege escalation', () => {
  it('prevents cross-tenant retrieval when tenantId in request mismatches trusted context', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a secret'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
      {
        chunk: makeChunk('b::0', 'doc-b', 'tenant-b', 'tenant-b secret'),
        embedding: makeEmbedding('b::0', [0, 1]),
      },
    ]);

    // Trusted context is tenant-a; request tries to read tenant-b
    const result = await retrieve(
      { text: 'q', topK: 5, tenantId: 'tenant-b' },
      { embeddingProvider: provider, vectorStore: store },
      makeAuthz('tenant-a'),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path === 'authorization')).toBe(true);
  });

  it('denies retrieval when no trusted authz context is provided but request supplies tenant filter', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a secret'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
    ]);

    // Client-supplied tenantId without trusted authz context must fail closed
    const result = await retrieve(
      { text: 'q', topK: 5, tenantId: 'tenant-a' },
      { embeddingProvider: provider, vectorStore: store },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path === 'authorization')).toBe(true);
  });

  it('allows retrieval when trusted authz context matches request tenant', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a secret'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
    ]);

    const result = await retrieve(
      { text: 'q', topK: 5, tenantId: 'tenant-a' },
      { embeddingProvider: provider, vectorStore: store },
      makeAuthz('tenant-a'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.length).toBeGreaterThan(0);
    expect(result.value[0]?.sourceId).toBe('doc-a');
  });

  it('fails closed when authorization evaluator throws', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a secret'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
    ]);

    const result = await retrieve(
      { text: 'q', topK: 5 },
      { embeddingProvider: provider, vectorStore: store },
      {
        context: { tenantId: 'tenant-a' },
        evaluate: () => {
          throw new Error('policy engine crashed');
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path === 'authorization')).toBe(true);
  });

  it('fails closed when authorization evaluator returns ok:false', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a secret'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
    ]);

    const result = await retrieve(
      { text: 'q', topK: 5 },
      { embeddingProvider: provider, vectorStore: store },
      {
        context: { tenantId: 'tenant-a' },
        evaluate: () => ({
          ok: false,
          issues: [{ path: 'policy', message: 'policy evaluation denied' }],
        }),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path === 'authorization')).toBe(true);
  });

  it('applies document allow-list filtering server-side', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'doc-a content'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
      {
        chunk: makeChunk('b::0', 'doc-b', 'tenant-a', 'doc-b content'),
        embedding: makeEmbedding('b::0', [0, 1]),
      },
    ]);

    const result = await retrieve(
      { text: 'q', topK: 5 },
      {
        embeddingProvider: provider,
        vectorStore: store,
      },
      {
        context: {
          tenantId: 'tenant-a',
          allowedDocumentIds: ['doc-a'],
        },
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only doc-a should be returned, doc-b should be filtered out
    expect(result.value.every((r) => r.sourceId === 'doc-a')).toBe(true);
  });

  it('does not leak other tenant chunks even when same embedding vector matches', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'tenant-a data'),
        embedding: makeEmbedding('a::0', [1, 0]),
      },
      {
        chunk: makeChunk('b::0', 'doc-b', 'tenant-b', 'tenant-b data'),
        embedding: makeEmbedding('b::0', [1, 0]),
      },
    ]);

    const result = await retrieve(
      { text: 'q', topK: 5 },
      { embeddingProvider: provider, vectorStore: store },
      makeAuthz('tenant-a'),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.every((r) => r.sourceId === 'doc-a')).toBe(true);
    expect(result.value.some((r) => r.sourceId === 'doc-b')).toBe(false);
  });
});

describe('red-team: privilege escalation via citation claims', () => {
  it('does not honor citedChunkIds for chunks not in retrieved context', async () => {
    const injectedChunk: RetrievalResult = {
      chunk: makeChunk('evil::0', 'evil-doc', 'tenant-a', 'malicious content'),
      score: 0.9,
      rank: 1,
      sourceId: 'evil-doc',
    };
    const legitChunk: RetrievalResult = {
      chunk: makeChunk('legit::0', 'legit-doc', 'tenant-a', 'legitimate content'),
      score: 0.8,
      rank: 2,
      sourceId: 'legit-doc',
    };

    const model = {
      model: 'test-model',
      generate: vi.fn(async () => ({
        text: 'Here is the answer.',
        citedChunkIds: ['evil::0', 'legit::0'],
      })),
    };

    const result = await generateGroundedAnswer(
      { query: 'q', context: [legitChunk] },
      { model },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Citations should only reference chunks actually in context
    expect(result.value.citations.some((c) => c.chunkId === 'evil::0')).toBe(
      false,
    );
    expect(
      result.value.citations.some((c) => c.chunkId === 'legit::0'),
    ).toBe(true);
  });

  it('rejects model generation with unexpected model (expectedModel fail-closed)', async () => {
    const chunk: RetrievalResult = {
      chunk: makeChunk('a::0', 'doc-a', 'tenant-a', 'content'),
      score: 0.9,
      rank: 1,
      sourceId: 'doc-a',
    };

    const model = {
      model: 'unexpected-model',
      generate: vi.fn(async () => ({ text: 'answer' })),
    };

    const result = await generateGroundedAnswer(
      { query: 'q', context: [chunk] },
      { model, expectedModel: 'approved-model' },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path === 'model')).toBe(true);
  });
});
