import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../src/retrieve.js';
import type {
  Chunk,
  Embedding,
  RetrievalAuthorization,
  RetrievalResult,
  SparseVectorStore,
  VectorStore,
} from '../src/types.js';
import type { RetrieverDependencies } from '../src/retrieve.js';

const DIMENSIONS = 2;

function makeChunk(id: string, docId: string, content = 'content'): Chunk {
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

function makeEmbedding(id: string, vector: number[]): Embedding {
  return {
    chunkId: id,
    model: 'test-embed',
    dimensions: vector.length,
    vector,
  };
}

function makeResult(chunk: Chunk, score: number, rank = 0): RetrievalResult {
  return { chunk, score, rank, sourceId: chunk.documentId };
}

function makeEmbeddingProvider(
  vectorsByText: Record<string, number[]>,
): RetrieverDependencies['embeddingProvider'] {
  return {
    model: 'test-embed',
    dimensions: DIMENSIONS,
    embedTexts: vi.fn(async (texts) =>
      texts.map((t) => {
        const vector = vectorsByText[t];
        if (!vector) {
          throw new Error(`no vector for text: ${t}`);
        }
        return makeEmbedding(`q:${texts.indexOf(t)}`, vector);
      }),
    ),
  };
}

function makeVectorStore(
  resultsByQuery: Record<string, RetrievalResult[]>,
): VectorStore {
  return {
    kind: 'test',
    dimensions: DIMENSIONS,
    query: vi.fn(async (_request, _queryEmbedding) => {
      const text = Object.keys(resultsByQuery).find((t) => _request.text.includes(t));
      const results = text ? resultsByQuery[text] : [];
      return { ok: true, value: results };
    }),
  };
}

function makeSparseStore(
  resultsByQuery: Record<string, RetrievalResult[]>,
): SparseVectorStore {
  return {
    kind: 'test-sparse',
    query: vi.fn(async (_request, _sparseVector) => {
      const text = Object.keys(resultsByQuery).find((t) => _request.text.includes(t));
      const results = text ? resultsByQuery[text] : [];
      return { ok: true, value: results };
    }),
  };
}

function makeDeps(overrides: {
  embeddingProvider?: RetrieverDependencies['embeddingProvider'];
  vectorStore?: VectorStore;
  sparseStore?: SparseVectorStore;
  hybridOptions?: { enabled?: boolean; rrfK?: number; candidateLimit?: number };
}): RetrieverDependencies {
  return {
    embeddingProvider: overrides.embeddingProvider ?? makeEmbeddingProvider({}),
    vectorStore: overrides.vectorStore ?? makeVectorStore({}),
    ...(overrides.sparseStore ? { sparseStore: overrides.sparseStore } : {}),
    ...(overrides.hybridOptions ? { hybridOptions: overrides.hybridOptions } : {}),
  };
}

describe('retrieve with hybrid (dense + sparse) retrieval', () => {
  it('uses dense-only when no sparseStore is configured (baseline path preserved)', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [makeResult(makeChunk('c1', 'd1'), 0.9, 1)],
    });
    const deps = makeDeps({ embeddingProvider, vectorStore });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    // Sparse store should not exist
    expect((deps as RetrieverDependencies & { sparseStore?: unknown }).sparseStore).toBeUndefined();
  });

  it('uses dense-only when hybrid is not enabled even if sparseStore exists', async () => {
    const sparseStore = makeSparseStore({
      'original query': [makeResult(makeChunk('c-sparse', 'd-sparse'), 0.9, 1)],
    });
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [makeResult(makeChunk('c1', 'd1'), 0.9, 1)],
    });
    const deps = makeDeps({
      embeddingProvider,
      vectorStore,
      sparseStore,
      hybridOptions: { enabled: false },
    });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    // Sparse store should not have been called
    expect(sparseStore.query).not.toHaveBeenCalled();
  });

  it('fuses dense and sparse results via RRF when hybrid is enabled', async () => {
    const embeddingProvider = makeEmbeddingProvider({
      'original query': [1, 0],
    });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
        makeResult(makeChunk('c2', 'd2'), 0.5, 2),
      ],
    });
    const sparseStore = makeSparseStore({
      'original query': [
        makeResult(makeChunk('c2', 'd2'), 0.8, 1),
        makeResult(makeChunk('c3', 'd3'), 0.7, 2),
      ],
    });
    const deps = makeDeps({
      embeddingProvider,
      vectorStore,
      sparseStore,
      hybridOptions: { enabled: true },
    });

    const result = await retrieve({ text: 'original query', topK: 10 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both dense and sparse stores were queried
    expect(vectorStore.query).toHaveBeenCalledTimes(1);
    expect(sparseStore.query).toHaveBeenCalledTimes(1);
    // c2 appears in both dense and sparse, so RRF should rank it highest
    expect(result.value).toHaveLength(3);
    expect(result.value[0]?.chunk.id).toBe('c2');
    expect(result.value[0]?.rank).toBe(1);
  });

  it('falls back to dense results when sparse retrieval fails', async () => {
    const sparseStore = makeSparseStore({});
    // Make sparse query throw
    sparseStore.query.mockRejectedValueOnce(new Error('sparse failure'));
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [makeResult(makeChunk('c1', 'd1'), 0.9, 1)],
    });
    const deps = makeDeps({
      embeddingProvider,
      vectorStore,
      sparseStore,
      hybridOptions: { enabled: true },
    });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
  });

  it('applies document allowlist after RRF fusion', async () => {
    const embeddingProvider = makeEmbeddingProvider({
      'original query': [1, 0],
    });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
        makeResult(makeChunk('c2', 'd2'), 0.5, 2),
      ],
    });
    const sparseStore = makeSparseStore({
      'original query': [
        makeResult(makeChunk('c2', 'd2'), 0.8, 1),
        makeResult(makeChunk('c3', 'd3'), 0.7, 2),
      ],
    });
    const deps = makeDeps({
      embeddingProvider,
      vectorStore,
      sparseStore,
      hybridOptions: { enabled: true },
    });

    const authz: RetrievalAuthorization = {
      context: { tenantId: 'tenant-a', allowedDocumentIds: ['d1', 'd2'] },
    };

    const result = await retrieve({ text: 'original query', topK: 10 }, deps, authz);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // d3 should be filtered out
    expect(result.value.every((r) => r.sourceId !== 'd3')).toBe(true);
    // Sparse store query should have received tenant filter
    const sparseCall = sparseStore.query.mock.calls[0];
    expect(sparseCall[0].tenantId).toBe('tenant-a');
  });

  it('returns empty array when no results match in hybrid mode', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({});
    const sparseStore = makeSparseStore({});
    const deps = makeDeps({
      embeddingProvider,
      vectorStore,
      sparseStore,
      hybridOptions: { enabled: true },
    });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });
});
