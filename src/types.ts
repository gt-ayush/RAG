/**
 * Shared domain types for the RAG pipeline.
 * Keep these contracts stable and validate untrusted data at system boundaries
 * before constructing values of these types.
 */

export type DocumentId = string;
export type ChunkId = string;

export interface DocumentMetadata {
  /** Stable source/document identifier. */
  documentId: DocumentId;
  /** Human-readable source reference (path, URL, title, etc.). */
  source: string;
  /** Optional source details for traceability/citations. */
  page?: number;
  section?: string;
  /** Tenant/user scoping metadata when applicable (authorization enforced server-side). */
  tenantId?: string;
  /** Ingestion/indexing metadata. */
  ingestedAt?: string; // ISO timestamp
  contentHash?: string;
  /** Provider/source-specific metadata; treat as untrusted at boundaries. */
  attributes?: Record<string, unknown>;
}

export interface Document {
  id: DocumentId;
  content: string;
  metadata: DocumentMetadata;
}

export interface ChunkMetadata extends DocumentMetadata {
  chunkId: ChunkId;
  chunkIndex: number;
  /** Character/token offsets within the source document when known. */
  startOffset?: number;
  endOffset?: number;
}

export interface Chunk {
  id: ChunkId;
  documentId: DocumentId;
  content: string;
  /** Zero-based position of this chunk within its document. */
  index: number;
  metadata: ChunkMetadata;
}

export type EmbeddingVector = readonly number[];

export interface Embedding {
  chunkId: ChunkId;
  model: string;
  dimensions: number;
  vector: EmbeddingVector;
}

export interface RetrievalQuery {
  text: string;
  topK: number;
  /** Optional filters must be applied/enforced by trusted server-side logic. */
  tenantId?: string;
  filters?: Record<string, unknown>;
}

/** Sparse vector representation: term indices and their weights. */
export interface SparseVector {
  /** Indices of non-zero dimensions (e.g. token IDs). */
  indices: readonly number[];
  /** Weight for each index (e.g. BM25 term weight). */
  values: readonly number[];
}

/** Sparse embedding for a chunk (e.g. BM25 sparse vector). */
export interface SparseEmbedding {
  chunkId: ChunkId;
  model: string;
  sparseVector: SparseVector;
}

/** Result of sparse retrieval; reuses the same shape as dense results. */
export type SparseRetrievalResult = RetrievalResult;

/** Options controlling hybrid (dense + sparse) retrieval behavior. */
export interface HybridRetrievalOptions {
  /** Enable hybrid retrieval (dense + sparse with RRF fusion). Default false. */
  enabled?: boolean;
  /** RRF fusion constant k. Default 60. */
  rrfK?: number;
  /** Maximum number of candidates per retriever before fusion. */
  candidateLimit?: number;
}

/** Sparse vector store for hybrid retrieval. Queries using sparse vectors
 * (e.g. BM25) instead of dense embeddings. */
export interface SparseVectorStore {
  readonly kind: string;
  /** Retrieve relevant chunks using a sparse vector; must apply trusted
   * server-side filters before returning. */
  query(
    query: RetrievalQuery,
    sparseVector: SparseVector,
  ): Promise<Result<readonly SparseRetrievalResult[]>>;
}

/** Budget and behavior controls for query transformation. */
export interface QueryTransformationOptions {
  /** Maximum number of variant queries to produce (including the original). */
  maxVariants?: number;
  /** Maximum tokens allowed per variant query. */
  maxTokensPerVariant?: number;
  /** Per-transformation timeout in milliseconds. */
  timeoutMs?: number;
}

/** Result of a query transformation: variant queries to retrieve against. */
export interface QueryTransformationResult {
  /** Variant queries (should include the original query for completeness). */
  variants: readonly string[];
  /** Whether the transformer was applied or bypassed. */
  applied: boolean;
}

/**
 * Transforms a user query into variant queries for retrieval (rewrite,
 * decompose, expand). Implementations must respect the budget options and
 * never return more than maxVariants variants. Failures should be surfaced
 * as Result issues; the caller falls back to the original query.
 */
export type QueryTransformer = (
  query: string,
  options: QueryTransformationOptions,
) => Promise<Result<QueryTransformationResult>>;

export interface RetrievalResult {
  chunk: Chunk;
  /** Similarity/ranking score from retrieval/reranking; not a calibrated probability. */
  score: number;
  rank: number;
  sourceId: DocumentId;
}

/** Options controlling reranking behavior and the empty-context refusal threshold. */
export interface RerankerConfig {
  /** Minimum score a result must have to be kept after reranking. */
  minScore?: number;
  /** Maximum number of results to return after reranking. */
  maxResults?: number;
}

/** Result of reranking: re-ranked results plus whether any passed the threshold. */
export interface RerankerResult {
  results: readonly RetrievalResult[];
  /** True when at least one result passed the minScore threshold. */
  hasEvidence: boolean;
}

/** Resolved principal from a trusted authentication source (e.g. JWT, session). */
export interface AuthorizationPrincipal {
  /** Trusted tenant identity resolved server-side; never from client input. */
  tenantId: string;
  /** Optional set of document IDs the principal is allowed to access. */
  allowedDocumentIds?: readonly string[];
  /** Optional roles granted to the principal. */
  roles?: readonly string[];
}

/** Policy decision for an authorization request. */
export interface AuthorizationDecision {
  /** True when the principal is authorized for the request. */
  allowed: boolean;
  /** Reason for the decision, for auditing. */
  reason: string;
  /** Tenant scope to enforce, if allowed. */
  tenantId?: string;
  /** Document allow-list to enforce, if allowed. */
  allowedDocumentIds?: readonly string[];
}

/**
 * Evaluates authorization for a retrieval request against a trusted principal.
 * Implementations must fail closed: on error or uncertainty, return allowed=false.
 */
export type AuthorizationPolicy = (
  principal: AuthorizationPrincipal,
  request: RetrievalQuery,
) => Promise<AuthorizationDecision> | AuthorizationDecision;

/** Configuration for the tenant authorization policy. */
export interface TenantAuthorizationPolicyConfig {
  /** Tenant ID that the principal must belong to. */
  tenantId: string;
  /** Optional allow-list of document IDs the principal may access. */
  allowedDocumentIds?: readonly string[];
}

export interface Citation {
  sourceId: DocumentId;
  chunkId: ChunkId;
  source: string;
  page?: number;
  section?: string;
  /** Excerpt or locator used to ground a claim. */
  quote?: string;
}

export interface GenerationRequest {
  query: string;
  context: readonly RetrievalResult[];
}

export interface GeneratedAnswer {
  text: string;
  citations: readonly Citation[];
  /** True when the available context was insufficient to answer reliably. */
  insufficientContext: boolean;
}

/** Configuration for an embedding provider that returns vectors to the caller. */
export interface EmbeddingProviderConfig {
  /** Base URL of an OpenAI-compatible embeddings API (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  /** Model identifier sent to the provider; pinned and checked against responses. */
  model: string;
  /** Expected embedding dimensionality; mismatches fail closed. */
  dimensions: number;
  /** Optional provider API key; never logged or included in error messages. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

/** Configuration for a chat/LLM provider that returns generated text to the caller. */
export interface LLMProviderConfig {
  /** Base URL of an OpenAI-compatible chat completions API (e.g. https://api.openai.com/v1). */
  baseUrl: string;
  /** Model identifier sent to the provider; pinned and checked against responses. */
  model: string;
  /** Optional provider API key; never logged or included in error messages. */
  apiKey?: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
}

export interface PipelineConfig {
  llm: {
    apiKey: string;
    model: string;
    /** Optional LLM API base URL (OpenAI-compatible providers). */
    baseUrl?: string;
    /** Optional per-request timeout in milliseconds. */
    timeoutMs?: number;
  };
  vectorDb: {
    url: string;
    apiKey?: string;
  };
  embedding: {
    model: string;
    /** Optional embeddings API base URL (OpenAI-compatible providers). */
    baseUrl?: string;
    /** Optional expected embedding dimensions. */
    dimensions?: number;
    /** Optional embeddings API key. */
    apiKey?: string;
    /** Optional per-request timeout in milliseconds. */
    timeoutMs?: number;
  };
}

export interface PipelineResponse {
  answer: GeneratedAnswer;
  retrieved: readonly RetrievalResult[];
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export class ConfigValidationError extends Error {
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    const details = issues.map((i) => `${i.path}: ${i.message}`).join('; ');
    super(`Invalid configuration: ${details}`);
    this.name = 'ConfigValidationError';
    this.issues = issues;
  }
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };
