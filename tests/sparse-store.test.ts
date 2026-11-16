import { describe, expect, it } from 'vitest';
import { SparseMemoryStore } from '../src/sparse-store.js';
import type { Chunk, SparseEmbedding, SparseVector } from '../src/types.js';

const DIMENSIONS = 2;

function makeChunk(id: string, docId: string, content = 'content', tenantId?: string): Chunk {
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
      ...(tenantId ? { tenantId } : {}),
    },
  };
}

function makeSparseEmbedding(id: string): SparseEmbedding {
  return {
    chunkId: id,
    model: 'bm25',
    sparseVector: { indices: [0, 1], values: [1, 1] },
  };
}

function makeRecord(id: string, docId: string, content: string, tenantId?: string) {
  return {
    chunk: makeChunk(id, docId, content, tenantId),
    sparseEmbedding: makeSparseEmbedding(id),
  };
}

describe('SparseMemoryStore (BM25)', () => {
  it('upserts and returns records via getAllRecords', async () => {
    const store = new SparseMemoryStore();
    const result = await store.upsert([makeRecord('c1', 'doc-1', 'the quick brown fox')]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.upserted).toBe(1);

    const records = store.getAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.chunk.id).toBe('c1');
    expect(records[0]!.chunk.documentId).toBe('doc-1');
  });

  it('idempotent upsert replaces existing record for same chunk id', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([makeRecord('c1', 'doc-1', 'the quick brown fox')]);
    await store.upsert([makeRecord('c1', 'doc-1', 'the quick brown fox jumps over')]);

    const records = store.getAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.chunk.content).toBe('the quick brown fox jumps over');
    expect(store.documentCount()).toBe(1);
  });

  it('ranks documents by BM25 score, exact term match scores higher', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([
      makeRecord('c1', 'doc-1', 'the quick brown fox'),
      makeRecord('c2', 'doc-2', 'the lazy dog sleeps'),
    ]);

    const result = await store.query(
      { text: 'quick brown', topK: 5 },
      { indices: [], values: [] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only doc-1 contains query terms 'quick' and 'brown'; doc-2 has neither.
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.chunk.documentId).toBe('doc-1');
    expect(result.value[0]!.score).toBeGreaterThan(0);
  });

  it('applies tenant filtering', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([
      makeRecord('c1', 'doc-1', 'secret tenant a content', 'tenant-a'),
      makeRecord('c2', 'doc-2', 'secret tenant b content', 'tenant-b'),
    ]);

    const result = await store.query(
      { text: 'secret', topK: 5, tenantId: 'tenant-a' },
      { indices: [], values: [] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.chunk.documentId).toBe('doc-1');
  });

  it('deletes all chunks for a document id', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([
      makeRecord('c1', 'doc-1', 'content one'),
      makeRecord('c2', 'doc-1', 'content two'),
      makeRecord('c3', 'doc-2', 'content three'),
    ]);

    const deleted = await store.deleteByDocumentId('doc-1');
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.value.deleted).toBe(2);

    const records = store.getAllRecords();
    expect(records).toHaveLength(1);
    expect(records[0]!.chunk.documentId).toBe('doc-2');
    expect(store.documentCount()).toBe(1);
  });

  it('returns empty results when no documents match', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([makeRecord('c1', 'doc-1', 'the quick brown fox')]);

    const result = await store.query(
      { text: 'nonexistent term xyz', topK: 5 },
      { indices: [], values: [] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('respects topK limit', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([
      makeRecord('c1', 'doc-1', 'alpha beta gamma'),
      makeRecord('c2', 'doc-2', 'alpha beta gamma delta'),
      makeRecord('c3', 'doc-3', 'alpha'),
    ]);

    const result = await store.query(
      { text: 'alpha beta gamma', topK: 2 },
      { indices: [], values: [] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('rejects invalid topK', async () => {
    const store = new SparseMemoryStore();

    const result = await store.query(
      { text: 'test', topK: 0 },
      { indices: [], values: [] },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.path === 'query.topK')).toBe(true);
    }
  });

  it('sparse vector parameter is accepted but not required', async () => {
    const store = new SparseMemoryStore();
    await store.upsert([makeRecord('c1', 'doc-1', 'the quick brown fox')]);

    // Pass a non-empty sparse vector; should be ignored by this implementation.
    const result = await store.query(
      { text: 'quick brown', topK: 5 },
      { indices: [0, 1, 2], values: [0.5, 0.5, 0.5] } as SparseVector,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.chunk.documentId).toBe('doc-1');
  });
});
