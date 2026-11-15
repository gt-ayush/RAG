import { describe, expect, it } from 'vitest';
import { LexicalReranker } from '../src/reranker.js';
import type { Chunk, RetrievalQuery, RetrievalResult } from '../src/types.js';
import type { RetrievalReranker } from '../src/retrieve.js';

function makeChunk(id: string, docId: string, content: string): Chunk {
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
    },
  };
}

function makeResult(chunk: Chunk, score: number, rank = 0): RetrievalResult {
  return { chunk, score, rank, sourceId: chunk.documentId };
}

const query: RetrievalQuery = {
  text: 'remote work policy',
  topK: 10,
};

describe('LexicalReranker', () => {
  it('re-ranks results by lexical overlap score descending', async () => {
    const reranker = new LexicalReranker({});

    const low = makeResult(
      makeChunk('c-low', 'd1', 'unrelated topic about cats and dogs'),
      0.1,
      1,
    );
    const high = makeResult(
      makeChunk('c-high', 'd1', 'remote work policy for employees'),
      0.9,
      2,
    );
    const medium = makeResult(
      makeChunk('c-med', 'd1', 'work policy guidelines'),
      0.5,
      3,
    );

    const result = await reranker.rerank(query, [low, high, medium]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(3);
    expect(result.value[0]?.chunk.id).toBe('c-med');
    expect(result.value[1]?.chunk.id).toBe('c-high');
    expect(result.value[2]?.chunk.id).toBe('c-low');
    expect(result.value[0]?.rank).toBe(1);
    expect(result.value[1]?.rank).toBe(2);
    expect(result.value[2]?.rank).toBe(3);
  });

  it('drops results below minScore threshold (refusal)', async () => {
    const reranker = new LexicalReranker({ minScore: 0.5 });

    const low = makeResult(
      makeChunk('c-low', 'd1', 'unrelated topic about cats and dogs'),
      0.1,
      1,
    );
    const high = makeResult(
      makeChunk('c-high', 'd1', 'remote work policy for employees'),
      0.9,
      2,
    );

    const result = await reranker.rerank(query, [low, high]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c-high');
  });

  it('returns empty when all results are below minScore threshold', async () => {
    const reranker = new LexicalReranker({ minScore: 0.9 });

    const low = makeResult(
      makeChunk('c-low', 'd1', 'unrelated topic about cats and dogs'),
      0.1,
      1,
    );

    const result = await reranker.rerank(query, [low]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('caps results at maxResults', async () => {
    const reranker = new LexicalReranker({ maxResults: 2 });

    const r1 = makeResult(makeChunk('c1', 'd1', 'remote work policy'), 0.9, 1);
    const r2 = makeResult(makeChunk('c2', 'd1', 'work policy guidelines'), 0.8, 2);
    const r3 = makeResult(makeChunk('c3', 'd1', 'remote work details'), 0.7, 3);

    const result = await reranker.rerank(query, [r1, r2, r3]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
  });

  it('returns empty for empty query text', async () => {
    const reranker = new LexicalReranker({});

    const result = await reranker.rerank(
      { ...query, text: '' },
      [makeResult(makeChunk('c1', 'd1', 'remote work policy'), 0.9, 1)],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it('is assignable to the RetrievalReranker hook type', () => {
    const reranker = new LexicalReranker({ minScore: 0.1 });
    const _check: RetrievalReranker = reranker.rerank.bind(reranker);
    expect(_check).toBeDefined();
  });
});

describe('LexicalReranker with retrieve() integration', () => {
  it('returns empty context when reranker drops all results below threshold', async () => {
    const { retrieve } = await import('../src/retrieve.js');
    const { MemoryVectorStore } = await import('../src/memory-store.js');

    const store = new MemoryVectorStore(2);
    await store.upsert([
      {
        chunk: makeChunk('c1', 'd1', 'remote work policy for employees'),
        embedding: {
          chunkId: 'c1',
          model: 'test-embed',
          dimensions: 2,
          vector: [1, 0],
        },
      },
    ]);

    const embeddingProvider = {
      model: 'test-embed',
      dimensions: 2,
      embedTexts: async () => [
        { chunkId: 'q', model: 'test-embed', dimensions: 2, vector: [1, 0] },
      ],
    };

    const reranker = new LexicalReranker({ minScore: 0.9 });
    const deps = {
      embeddingProvider,
      vectorStore: store,
      reranker: reranker.rerank.bind(reranker),
    };

    const result = await retrieve(
      { text: 'completely unrelated query about quantum physics', topK: 5 },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // All results dropped below threshold → empty context → insufficient context in generate
    expect(result.value).toEqual([]);
  });
});
