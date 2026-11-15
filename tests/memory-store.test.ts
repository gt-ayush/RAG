import { describe, expect, it } from 'vitest';
import { MemoryVectorStore } from '../src/memory-store.js';
import type { Chunk, Embedding } from '../src/types.js';

function makeRecord(id: string, docId: string, vector: number[], content = 'content'): { chunk: Chunk; embedding: Embedding } {
  const chunk: Chunk = {
    id,
    documentId: docId,
    content,
    index: 0,
    metadata: {
      documentId: docId,
      source: `${docId}.txt`,
      chunkId: id,
      chunkIndex: 0,
      contentHash: 'hash',
    },
  };
  const embedding: Embedding = {
    chunkId: id,
    model: 'test-embed',
    dimensions: vector.length,
    vector,
  };
  return { chunk, embedding };
}

describe('MemoryVectorStore', () => {
  it('upserts idempotently by chunk id and preserves traceable metadata', async () => {
    const store = new MemoryVectorStore(3);
    const r1 = makeRecord('d1::chunk::0', 'd1', [1, 0, 0], 'v1');

    const first = await store.upsert([r1]);
    expect(first).toEqual({ ok: true, value: { upserted: 1 } });

    const updated = makeRecord('d1::chunk::0', 'd1', [0, 1, 0], 'v2');
    const second = await store.upsert([updated]);
    expect(second).toEqual({ ok: true, value: { upserted: 1 } });

    const all = store.getAllRecords();
    expect(all).toHaveLength(1);
    expect(all[0]?.chunk.content).toBe('v2');
    expect(all[0]?.chunk.metadata.source).toBe('d1.txt');
    expect(all[0]?.chunk.metadata.documentId).toBe('d1');
    expect(all[0]?.embedding.vector).toEqual([0, 1, 0]);
  });

  it('deletes indexed records by document id for lifecycle/re-ingestion flows', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'd1', [1, 0]),
      makeRecord('d1::chunk::1', 'd1', [0, 1]),
      makeRecord('d2::chunk::0', 'd2', [1, 1]),
    ]);

    const deleted = await store.deleteByDocumentId('d1');
    expect(deleted).toEqual({ ok: true, value: { deleted: 2 } });
    expect(store.getAllRecords().map((r) => r.chunk.id)).toEqual(['d2::chunk::0']);
  });

  it('queries by similarity and returns traceable ranked results', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'd1', [1, 0]),
      makeRecord('d2::chunk::0', 'd2', [0, 1]),
    ]);

    const result = await store.query(
      { text: 'q', topK: 1 },
      { chunkId: 'q', model: 'test-embed', dimensions: 2, vector: [0.9, 0.1] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('d1::chunk::0');
    expect(result.value[0]?.sourceId).toBe('d1');
    expect(result.value[0]?.rank).toBe(1);
    expect(result.value[0]?.chunk.metadata.source).toBe('d1.txt');
  });

  it('rejects dimension-mismatched upserts/queries', async () => {
    const store = new MemoryVectorStore(3);
    const badUpsert = await store.upsert([makeRecord('d1::chunk::0', 'd1', [1, 0])]);
    expect(badUpsert.ok).toBe(false);

    const badQuery = await store.query(
      { text: 'q', topK: 1 },
      { chunkId: 'q', model: 'test-embed', dimensions: 2, vector: [1, 0] },
    );
    expect(badQuery.ok).toBe(false);
  });
});
