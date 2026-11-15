import type { EmbeddingProvider } from './embeddings.js';
import { validateQueryEmbedding } from './embeddings.js';
import type { RetrievalQuery, RetrievalResult, Result } from './types.js';
import type { VectorStore } from './vector-store.js';

export interface RetrieveRequest extends RetrievalQuery {
  text: string;
}

export type RetrievalReranker = (
  query: RetrieveRequest,
  results: readonly RetrievalResult[],
) => Promise<Result<readonly RetrievalResult[]>> | Result<readonly RetrievalResult[]>;

export interface RetrieverDependencies {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  /** Optional post-retrieval ranking/filter step (e.g. reranker/fusion adapter). */
  reranker?: RetrievalReranker;
}

/**
 * Baseline retrieval: embed the query, validate compatibility, query the vector
 * store, then optionally apply a reranker while preserving traceability.
 */
export async function retrieve(
  request: RetrieveRequest,
  deps: RetrieverDependencies,
): Promise<Result<readonly RetrievalResult[]>> {
  const expected = {
    model: deps.embeddingProvider.model,
    dimensions: deps.vectorStore.dimensions,
  };

  if (!request.text || request.text.trim().length === 0) {
    return { ok: false, issues: [{ path: 'text', message: 'query text is required' }] };
  }
  if (!Number.isInteger(request.topK) || request.topK <= 0) {
    return { ok: false, issues: [{ path: 'topK', message: 'must be a positive integer' }] };
  }

  let embeddings;
  try {
    embeddings = await deps.embeddingProvider.embedTexts([request.text], 'query');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'query embedding failed';
    return { ok: false, issues: [{ path: 'embeddingProvider', message }] };
  }

  const queryEmbedding = embeddings[0];
  if (!queryEmbedding) {
    return { ok: false, issues: [{ path: 'embeddingProvider', message: 'no query embedding returned' }] };
  }

  const validated = validateQueryEmbedding(queryEmbedding, expected);
  if (!validated.ok) {
    return validated;
  }

  const retrieved = await deps.vectorStore.query(request, validated.value);
  if (!retrieved.ok || !deps.reranker) {
    return retrieved;
  }

  const reranked = await deps.reranker(request, retrieved.value);
  if (!reranked.ok) {
    return reranked;
  }

  const limited = reranked.value.slice(0, request.topK).map((r, idx) => ({
    ...r,
    rank: idx + 1,
  }));
  return { ok: true, value: limited };
}
