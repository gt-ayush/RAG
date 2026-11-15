import type { EmbeddingProvider } from './embeddings.js';
import { validateQueryEmbedding } from './embeddings.js';
import type { RetrievalQuery, RetrievalResult, Result, ValidationIssue } from './types.js';
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
  /** Optional post-retrieval ranking/filter step (e.g. reranker/fusion adapter). */
  reranker?: RetrievalReranker;
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

  const scopedRequest: RetrieveRequest = {
    ...request,
    ...(authorized.value.tenantId ? { tenantId: authorized.value.tenantId } : {}),
  };

  const retrieved = await deps.vectorStore.query(scopedRequest, validated.value);
  if (!retrieved.ok) {
    return retrieved;
  }

  const scopedResults = applyDocumentAllowList(retrieved.value, authorized.value.allowedDocumentIds);
  if (!deps.reranker) {
    return { ok: true, value: scopedResults.slice(0, request.topK).map((r, idx) => ({ ...r, rank: idx + 1 })) };
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
