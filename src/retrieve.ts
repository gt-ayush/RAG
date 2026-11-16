import type { EmbeddingProvider } from './embeddings.js';
import { validateQueryEmbedding } from './embeddings.js';
import type {
  Chunk,
  DocumentId,
  HybridRetrievalOptions,
  QueryTransformationOptions,
  QueryTransformer,
  RetrievalQuery,
  RetrievalResult,
  Result,
  SparseRetrievalResult,
  SparseVector,
  SparseVectorStore,
  ValidationIssue,
} from './types.js';
import type { VectorStore } from './vector-store.js';

export interface RetrieveRequest extends RetrievalQuery {
  text: string;
}

export interface AuthorizationContext {
  /** Trusted tenant scope resolved server-side. */
  tenantId?: string;
  /** Trusted allow-list of document IDs resolved server-side. */
  allowedDocumentIds?: readonly string[];
}

export type AuthorizationEvaluator = (
  context: AuthorizationContext,
  request: RetrieveRequest,
) => Promise<Result<AuthorizationContext>> | Result<AuthorizationContext>;

export interface RetrievalAuthorization {
  /** Trusted server-side authorization context; never rely on client filters alone. */
  context: AuthorizationContext;
  /** Optional policy evaluation hook; failures must fail closed. */
  evaluate?: AuthorizationEvaluator;
}

export type RetrievalReranker = (
  query: RetrieveRequest,
  results: readonly RetrievalResult[],
) => Promise<Result<readonly RetrievalResult[]>> | Result<readonly RetrievalResult[]>;

export interface RetrieverDependencies {
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  /** Optional post-retrieval ranking/filter step (e.g. reranker/fusion adapter).
   * Use `LexicalReranker` from `./reranker.js` for a deterministic lexical
   * overlap scorer with a configurable minScore refusal threshold. */
  reranker?: RetrievalReranker;
  /** Optional pre-retrieval query transformation hook (rewrite/decompose/expand).
   * When provided, the original query is transformed into variants and each
   * variant is retrieved; results are merged via reciprocal-rank fusion.
   * When absent, the original query is used directly (bypass path). */
  queryTransformer?: QueryTransformer;
  /** Optional sparse vector store for hybrid retrieval (e.g. BM25). */
  sparseStore?: SparseVectorStore;
  /** Options controlling hybrid (dense + sparse) retrieval. Default: dense only. */
  hybridOptions?: HybridRetrievalOptions;
}

function authDenied(message: string): Result<never> {
  return { ok: false, issues: [{ path: 'authorization', message }] };
}

function resolveAuthorizedFilters(
  request: RetrieveRequest,
  authz?: RetrievalAuthorization,
): Result<{ tenantId?: string; allowedDocumentIds?: readonly string[] }> {
  if (!authz) {
    // No explicit authz context provided; do not invent permissions.
    // A client-supplied tenant filter without trusted authz context is not
    // sufficient authorization evidence; fail closed.
    if (request.tenantId) {
      return authDenied('trusted tenant authorization is required');
    }
    // Tenant/document scoping must be enforced by trusted callers in secured deployments.
    return { ok: true, value: {} };
  }

  const trusted = authz.context;
  if (request.tenantId && trusted.tenantId && request.tenantId !== trusted.tenantId) {
    return authDenied('tenant access denied');
  }
  if (trusted.tenantId === undefined && request.tenantId) {
    // Client-supplied tenant filter is not sufficient authorization evidence.
    return authDenied('trusted tenant authorization is required');
  }

  return {
    ok: true,
    value: {
      ...(trusted.tenantId ? { tenantId: trusted.tenantId } : {}),
      ...(trusted.allowedDocumentIds ? { allowedDocumentIds: trusted.allowedDocumentIds } : {}),
    },
  };
}

function applyDocumentAllowList(
  results: readonly RetrievalResult[],
  allowedDocumentIds?: readonly string[],
): readonly RetrievalResult[] {
  if (!allowedDocumentIds) return results;
  const allowed = new Set(allowedDocumentIds);
  return results.filter((r) => allowed.has(r.sourceId) || allowed.has(r.chunk.documentId));
}

/**
 * Multi-source reciprocal-rank fusion (RRF). Fuses multiple ranked result
 * sets into a single ranked list. Score = sum(1 / (k + rank)) across all
 * sources; results are deduplicated by chunk id and re-ranked by fused score.
 * k = 60 is the default.
 */
export function multiSourceRRF(
  sources: readonly RetrievalResult[][],
  k: number,
): RetrievalResult[] {
  const byChunk = new Map<string, { chunk: Chunk; sourceId: DocumentId; rrfScore: number }>();

  for (const results of sources) {
    for (const result of results) {
      const rrfContribution = 1 / (k + result.rank);
      const existing = byChunk.get(result.chunk.id);
      if (existing) {
        existing.rrfScore += rrfContribution;
      } else {
        byChunk.set(result.chunk.id, {
          chunk: result.chunk,
          sourceId: result.sourceId,
          rrfScore: rrfContribution,
        });
      }
    }
  }

  return [...byChunk.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore || a.chunk.id.localeCompare(b.chunk.id))
    .map((entry, idx) => ({
      chunk: entry.chunk,
      score: entry.rrfScore,
      rank: idx + 1,
      sourceId: entry.sourceId,
    }));
}

/**
 * Baseline retrieval: enforce trusted server-side authorization filters before
 * querying generation-facing context, fail closed on policy errors, then query
 * the vector store and optionally rerank traceable results.
 */
export async function retrieve(
  request: RetrieveRequest,
  deps: RetrieverDependencies,
  authz?: RetrievalAuthorization,
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

  let effectiveAuthz = authz;
  if (authz?.evaluate) {
    try {
      const evaluated = await authz.evaluate(authz.context, request);
      if (!evaluated.ok) return authDenied('authorization evaluation failed');
      effectiveAuthz = { context: evaluated.value };
    } catch {
      return authDenied('authorization evaluation failed');
    }
  }

  const authorized = resolveAuthorizedFilters(request, effectiveAuthz);
  if (!authorized.ok) return authorized;

  // Determine query variants: original query plus optional transformations.
  // When no queryTransformer is configured, the original query is used directly
  // (bypass path). Transformer failures fall back to the original query.
  const variants: string[] = [request.text];
  if (deps.queryTransformer) {
    const options: QueryTransformationOptions = {
      maxVariants: 3,
      timeoutMs: 1000,
    };
    try {
      const transformed = await deps.queryTransformer(request.text, options);
      if (transformed.ok && transformed.value.variants.length > 0) {
        const seen = new Set([request.text]);
        const uniqueVariants = transformed.value.variants.filter((v) => {
          if (seen.has(v)) return false;
          seen.add(v);
          return true;
        });
        const limit = Math.max(1, options.maxVariants ?? 3) - 1;
        variants.unshift(...uniqueVariants.slice(0, limit));
      }
    } catch {
      // Fall back to the original query only (bypass path).
    }
  }

  // Determine hybrid mode: enabled only when explicitly opted in AND a
  // sparse store is provided. Dense-only remains the default baseline path.
  const hybrid = deps.hybridOptions?.enabled === true && !!deps.sparseStore;
  const rrfK = deps.hybridOptions?.rrfK ?? 60;
  const candidateLimit = deps.hybridOptions?.candidateLimit ?? 50;

  // Embed all variants with the same provider; validate model/dimensions.
  let embeddings;
  try {
    embeddings = await deps.embeddingProvider.embedTexts(variants, 'query');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'query embedding failed';
    return { ok: false, issues: [{ path: 'embeddingProvider', message }] };
  }

  // Collect ranked results from all variants and (when hybrid) all modalities.
  // Each entry carries its rank within its (variant, modality) result set for
  // reciprocal-rank fusion.
  type RankedEntry = { result: RetrievalResult; source: string; rank: number };
  const allRanked: RankedEntry[] = [];

  const tenantId = authorized.value.tenantId;
  const emptySparse: SparseVector = { indices: [], values: [] };

  for (const [i, variant] of variants.entries()) {
    const queryEmbedding = embeddings[i];
    if (!queryEmbedding) continue;

    const validated = validateQueryEmbedding(queryEmbedding, expected);
    if (!validated.ok) continue;

    const scopedRequest: RetrieveRequest = {
      ...request,
      text: variant,
      ...(tenantId ? { tenantId } : {}),
    };

    // Dense retrieval for this variant.
    const denseRetrieved = await deps.vectorStore.query(scopedRequest, validated.value);
    if (!denseRetrieved.ok) continue;

    const denseCandidates = denseRetrieved.value.slice(0, candidateLimit);
    for (const [idx, result] of denseCandidates.entries()) {
      allRanked.push({ result, source: `dense:${variant}`, rank: idx + 1 });
    }

    // Sparse retrieval for this variant (hybrid mode only).
    if (hybrid && deps.sparseStore) {
      try {
        const sparseRetrieved = await deps.sparseStore.query(scopedRequest, emptySparse);
        if (sparseRetrieved.ok) {
          const sparseCandidates = sparseRetrieved.value.slice(0, candidateLimit);
          for (const [idx, result] of sparseCandidates.entries()) {
            allRanked.push({ result, source: `sparse:${variant}`, rank: idx + 1 });
          }
        }
      } catch {
        // Sparse retrieval failure does not fail the whole query; dense
        // results are still fused and returned.
      }
    }
  }

  if (allRanked.length === 0) {
    return { ok: true, value: [] };
  }

  // Merge results: RRF across all (variant, modality) result sets when hybrid
  // or multiple variants; otherwise use the single dense result set directly.
  let merged: RetrievalResult[];
  if (hybrid || allRanked.length > variants.length) {
    // Group by source for RRF: each source is one ranked result set.
    const bySource = new Map<string, RetrievalResult[]>();
    for (const entry of allRanked) {
      const existing = bySource.get(entry.source);
      if (existing) {
        existing.push(entry.result);
      } else {
        bySource.set(entry.source, [entry.result]);
      }
    }
    const sourceArrays = [...bySource.values()];
    // Multi-source RRF: fuse all ranked result sets.
    merged = multiSourceRRF(sourceArrays, rrfK);
  } else {
    const first = allRanked[0];
    if (!first) {
      return {
        ok: false,
        issues: [{ path: 'retrieval', message: 'no results retrieved' }],
      };
    }
    merged = allRanked
      .filter((e) => e.source === first.source)
      .map((e, idx) => ({ ...e.result, rank: idx + 1 }));
  }

  // Apply document allowlist (server-side), then optional reranker, then cap.
  const scopedResults = applyDocumentAllowList(merged, authorized.value.allowedDocumentIds);
  if (!deps.reranker) {
    return { ok: true, value: scopedResults.slice(0, request.topK) };
  }

  const reranked = await deps.reranker(request, scopedResults);
  if (!reranked.ok) {
    return reranked;
  }

  const limited = reranked.value.slice(0, request.topK).map((r, idx) => ({
    ...r,
    rank: idx + 1,
  }));
  return { ok: true, value: limited };
}
