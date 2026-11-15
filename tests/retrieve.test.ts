import { describe, expect, it, vi } from 'vitest';
import { MemoryVectorStore } from '../src/memory-store.js';
import { retrieve } from '../src/retrieve.js';
import type { Chunk, Embedding } from '../src/types.js';

function rec(id: string, docId: string, vector: number[], tenantId?: string) {
  const chunk: Chunk = {
    id,
    documentId: docId,
    content: `content-${id}`,
    index: 0,
    metadata: {
      documentId: docId,
      source: `${docId}.md`,
      chunkId: id,
      chunkIndex: 0,
      ...(tenantId ? { tenantId } : {}),
    },
  };
  const embedding: Embedding = { chunkId: id, model: 'm', dimensions: vector.length, vector };
  return { chunk, embedding };
}

function providerFor(vector: number[]) {
  return {
    model: 'm',
    dimensions: vector.length,
    embedTexts: vi.fn(async () => [{ chunkId: 'q', model: 'm', dimensions: vector.length, vector }]),
  };
}

describe('retrieve baseline', () => {
  it('returns ranked, traceable top-K results', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([rec('a::0', 'a', [1, 0]), rec('b::0', 'b', [0.8, 0.2]), rec('c::0', 'c', [0, 1])]);

    const result = await retrieve(
      { text: 'question', topK: 2 },
      { embeddingProvider: providerFor([1, 0]), vectorStore: store },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.chunk.id)).toEqual(['a::0', 'b::0']);
    expect(result.value.map((r) => r.rank)).toEqual([1, 2]);
    expect(result.value[0]?.sourceId).toBe('a');
    expect(result.value[0]?.chunk.metadata.source).toBe('a.md');
    expect(result.value[0]!.score).toBeGreaterThanOrEqual(result.value[1]!.score);
  });

  it('returns empty results when nothing matches/topK context is empty in store', async () => {
    const store = new MemoryVectorStore(2);
    const result = await retrieve(
      { text: 'question', topK: 3 },
      { embeddingProvider: providerFor([1, 0]), vectorStore: store },
    );
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('applies trusted tenant metadata filter when provided', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([rec('a::0', 'a', [1, 0], 't1'), rec('b::0', 'b', [1, 0], 't2')]);

    const result = await retrieve(
      { text: 'question', topK: 5, tenantId: 't1' },
      { embeddingProvider: providerFor([1, 0]), vectorStore: store },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.chunk.id)).toEqual(['a::0']);
  });

  it('validates request and embedding/provider failures', async () => {
    const store = new MemoryVectorStore(2);
    expect((await retrieve({ text: '  ', topK: 1 }, { embeddingProvider: providerFor([1, 0]), vectorStore: store })).ok).toBe(false);
    expect((await retrieve({ text: 'q', topK: 0 }, { embeddingProvider: providerFor([1, 0]), vectorStore: store })).ok).toBe(false);

    const failingProvider = {
      model: 'm',
      dimensions: 2,
      embedTexts: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const failed = await retrieve({ text: 'q', topK: 1 }, { embeddingProvider: failingProvider, vectorStore: store });
    expect(failed.ok).toBe(false);
  });
});
