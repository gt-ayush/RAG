import { describe, expect, it, vi } from 'vitest';
import { retrieve } from '../src/retrieve.js';
import type {
  Chunk,
  Embedding,
  EmbeddingProvider,
  RetrievalAuthorization,
  RetrievalResult,
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
): EmbeddingProvider {
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
      // Return results for the first matching query text; fall back to empty.
      const text = Object.keys(resultsByQuery).find((t) => _request.text.includes(t));
      const results = text ? resultsByQuery[text] : [];
      return { ok: true, value: results };
    }),
  };
}

function makeDeps(overrides: {
  embeddingProvider?: EmbeddingProvider;
  vectorStore?: VectorStore;
  queryTransformer?: RetrieverDependencies['queryTransformer'];
  reranker?: RetrieverDependencies['reranker'];
}): RetrieverDependencies {
  return {
    embeddingProvider: overrides.embeddingProvider ?? makeEmbeddingProvider({}),
    vectorStore: overrides.vectorStore ?? makeVectorStore({}),
    ...(overrides.queryTransformer ? { queryTransformer: overrides.queryTransformer } : {}),
    ...(overrides.reranker ? { reranker: overrides.reranker } : {}),
  };
}

describe('retrieve with query transformation', () => {
  it('bypasses transformation when no queryTransformer is configured', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
      ],
    });
    const deps: RetrieverDependencies = {
      embeddingProvider,
      vectorStore,
    };

    const result = await retrieve(
      { text: 'original query', topK: 5 },
      deps,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    // embedTexts called once with just the original query
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(['original query'], 'query');
    expect(vectorStore.query).toHaveBeenCalledTimes(1);
  });

  it('retrieves each variant and merges via RRF when transformer provides variants', async () => {

    const embeddingProvider = makeEmbeddingProvider({
      'original query': [1, 0],
      'rewritten query': [0, 1],
    });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
        makeResult(makeChunk('c2', 'd2'), 0.5, 2),
      ],
      'rewritten query': [
        makeResult(makeChunk('c2', 'd2'), 0.8, 1),
        makeResult(makeChunk('c3', 'd3'), 0.7, 2),
      ],
    });
    const queryTransformer = vi.fn(async () => ({
      ok: true,
      value: {
        variants: ['original query', 'rewritten query'],
        applied: true,
      },
    }));

    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve({ text: 'original query', topK: 10 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Both variants were embedded and retrieved (unique variants prepended)
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(
      ['rewritten query', 'original query'],
      'query',
    );
    expect(vectorStore.query).toHaveBeenCalledTimes(2);
    // RRF merged: c2 appears in both variants so should rank highest
    expect(result.value).toHaveLength(3);
    expect(result.value[0]?.chunk.id).toBe('c2');
    expect(result.value[0]?.rank).toBe(1);
    expect(queryTransformer).toHaveBeenCalledTimes(1);
  });

  it('falls back to original query when transformer throws', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
      ],
    });
    const queryTransformer = vi.fn(async () => {
      throw new Error('transformer failure');
    });

    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    // Only the original query was embedded (bypass path)
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(['original query'], 'query');
    expect(vectorStore.query).toHaveBeenCalledTimes(1);
  });

  it('falls back to original query when transformer returns ok:false', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
      ],
    });
    const queryTransformer = vi.fn(async () => ({
      ok: false,
      issues: [{ path: 'transformer', message: 'failed' }],
    }));

    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(['original query'], 'query');
    expect(vectorStore.query).toHaveBeenCalledTimes(1);
  });

  it('falls back to original query when transformer returns empty variants', async () => {
    const embeddingProvider = makeEmbeddingProvider({ 'original query': [1, 0] });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
      ],
    });
    const queryTransformer = vi.fn(async () => ({
      ok: true,
      value: {
        variants: [],
        applied: true,
      },
    }));

    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve({ text: 'original query', topK: 5 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('c1');
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(['original query'], 'query');
  });

  it('deduplicates variants and includes the original query', async () => {

    const embeddingProvider = makeEmbeddingProvider({
      'original query': [1, 0],
      'variant a': [0, 1],
    });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
      ],
      'variant a': [
        makeResult(makeChunk('c1', 'd1'), 0.8, 1),
      ],
    });
    // Transformer returns the original query as a variant too
    const queryTransformer = vi.fn(async () => ({
      ok: true,
      value: {
        variants: ['original query', 'variant a'],
        applied: true,
      },
    }));

    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve({ text: 'original query', topK: 10 }, deps);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Original query stays at index 0; unique variants are prepended (deduplicated)
    expect(embeddingProvider.embedTexts).toHaveBeenCalledWith(
      ['variant a', 'original query'],
      'query',
    );
    expect(vectorStore.query).toHaveBeenCalledTimes(2);
  });

  it('applies document allowlist after RRF merge', async () => {

    const embeddingProvider = makeEmbeddingProvider({
      'original query': [1, 0],
      'rewritten query': [0, 1],
    });
    const vectorStore = makeVectorStore({
      'original query': [
        makeResult(makeChunk('c1', 'd1'), 0.9, 1),
        makeResult(makeChunk('c2', 'd2'), 0.5, 2),
      ],
      'rewritten query': [
        makeResult(makeChunk('c2', 'd2'), 0.8, 1),
        makeResult(makeChunk('c3', 'd3'), 0.7, 2),
      ],
    });
    const queryTransformer = vi.fn(async () => ({
      ok: true,
      value: {
        variants: ['original query', 'rewritten query'],
        applied: true,
      },
    }));

    const authz: RetrievalAuthorization = {
      context: { tenantId: 'tenant-a', allowedDocumentIds: ['d1', 'd2'] },
    };
    const deps = makeDeps({ embeddingProvider, vectorStore, queryTransformer });

    const result = await retrieve(
      { text: 'original query', topK: 10 },
      deps,
      authz,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // d3 should be filtered out
    expect(result.value.every((r) => r.sourceId !== 'd3')).toBe(true);
    // The vector store query should have received the tenant filter
    const queryCall = vectorStore.query.mock.calls[0];
    expect(queryCall[0].tenantId).toBe('tenant-a');
  });
});
