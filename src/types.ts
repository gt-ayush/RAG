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

/** Record of an ingested source, used for re-index detection and lifecycle tracking. */
export interface IngestedSourceRecord {
  /** Stable source/document identifier. */
  documentId: DocumentId;
  /** Human-readable source reference (path, URL, title, etc.). */
  source: string;
  /** SHA-256 content hash at ingest time; used to detect changes on re-ingest. */
  contentHash: string;
  /** ISO timestamp when the source was last ingested. */
  ingestedAt: string;
  /** Number of chunks produced for this source. */
  chunkCount: number;
  /** Optional version label for the source (e.g. file mtime, document version). */
  version?: string;
}

/** Outcome of an ingestion lifecycle operation (re-index, delete, erasure). */
export interface IngestionLifecycleResult {
  /** Operation that was performed. */
  operation: 'reindex' | 'delete' | 'erasure';
  /** Whether the operation succeeded. */
  ok: boolean;
  /** Document id the operation targeted. */
  documentId: DocumentId;
  /** Number of chunks affected (upserted or deleted). */
  affectedChunkCount: number;
  /** Verification sweep result (for delete/erasure): residual chunk count found after deletion. */
  residualChunkCount?: number;
  /** Non-sensitive issue details when ok is false. */
  issues?: readonly ValidationIssue[];
}

/** Decision about whether a source needs re-indexing. */
export interface ReindexDecision {
  /** Whether re-indexing is needed. */
  needsReindex: boolean;
  /** Reason for the decision. */
  reason: 'new' | 'changed' | 'unchanged' | 'error';
  /** Existing record if one was found, otherwise undefined. */
  existingRecord?: IngestedSourceRecord;
}

/** Type of auditable pipeline event. */
export type AuditEventType =
  | 'query.received'
  | 'query.retrieved'
  | 'query.retrieval_error'
  | 'query.authorization_denied'
  | 'query.residency_denied'
  | 'generation.started'
  | 'generation.completed'
  | 'generation.error'
  | 'generation.insufficient_context'
  | 'ingestion.started'
  | 'ingestion.completed'
  | 'ingestion.error'
  | 'deletion.requested'
  | 'deletion.completed'
  | 'erasure.requested'
  | 'erasure.completed'
  | 'residency.checked';

/** Redaction level applied to an audit event field. */
export type AuditRedactionLevel = 'none' | 'hash' | 'redact';

/** A single append-only audit event for query/retrieval/generation/lifecycle. */
export interface AuditEvent {
  /** Monotonically increasing sequence number within the log. */
  seq: number;
  /** ISO-8601 UTC timestamp when the event occurred. */
  timestamp: string;
  /** Type of auditable event. */
  type: AuditEventType;
  /** Tenant scope (trusted, resolved server-side). */
  tenantId?: string;
  /** Document scope, if applicable. */
  documentId?: DocumentId;
  /** Optional correlation id linking query → retrieval → generation events. */
  correlationId?: string;
  /** Structured event payload; sensitive fields are redacted at write time. */
  payload: Record<string, unknown>;
  /** SHA-256 hex digest of the previous event's hash chain value (empty string for the first event). */
  previousHash: string;
  /** SHA-256 hex digest of this event (seq + timestamp + type + payload + previousHash). */
  hash: string;
}

/** Append-only audit log with integrity protection via hash chaining. */
export interface AuditLog {
  /** Append an event to the log. Returns the written event. The log
   * generates seq, timestamp, previousHash, and hash internally. */
  append(event: Omit<AuditEvent, 'seq' | 'hash' | 'timestamp' | 'previousHash'>): Promise<AuditEvent>;
  /** Read events within an optional seq range. */
  read(options?: { fromSeq?: number; toSeq?: number; limit?: number }): Promise<readonly AuditEvent[]>;
  /** Verify the integrity of the hash chain. Returns false if any link is broken. */
  verifyIntegrity(): Promise<boolean>;
  /** Number of events in the log. */
  count(): number;
}

/** Configuration for the audit trail. */
export interface AuditLogConfig {
  /** Maximum number of events to retain; older events are dropped on append. */
  maxEvents?: number;
  /** Retention period in days; events older than this are dropped on append. */
  retentionDays?: number;
}

/** Region-residency rule for a tenant/corpus. */
export interface ResidencyRule {
  /** Region where data must reside (e.g. 'us-east-1', 'eu-west-1'). */
  region: string;
  /** Tenant scope this rule applies to. */
  tenantId: string;
  /** Data classification tier this rule applies to. */
  tier?: 'Public' | 'Internal' | 'Confidential' | 'Restricted(PII)';
}

/** Result of a residency check. */
export interface ResidencyCheckResult {
  /** Whether the operation is allowed under residency rules. */
  allowed: boolean;
  /** Reason for the decision (for auditing). */
  reason: string;
  /** Region the data would reside in. */
  region?: string;
  /** Rule that was applied. */
  matchedRule?: ResidencyRule;
}

/** Request to erase a document across all stores (D1 raw, D2 vector, D4 policy). */
export interface ErasureRequest {
  /** Document identifier to erase. */
  documentId: DocumentId;
  /** Tenant performing the erasure (trusted, server-side). */
  tenantId: string;
  /** Legal basis for erasure (e.g. 'gdpr-article-17'). */
  legalBasis?: string;
  /** Requested completion deadline (ISO-8601). */
  deadline?: string;
}

/** Result of an erasure cascade operation. */
export interface ErasureResult {
  /** Whether erasure completed successfully. */
  ok: boolean;
  /** Document id that was targeted. */
  documentId: DocumentId;
  /** Timestamp when erasure was initiated (ISO-8601). */
  initiatedAt: string;
  /** Per-store erasure results. */
  storeResults: Array<{
    store: 'D1' | 'D2' | 'D4';
    deleted: number;
    ok: boolean;
    issues?: readonly ValidationIssue[];
  }>;
  /** Verification sweep result: residual chunks found after erasure. */
  residualChunkCount: number;
  /** Issues encountered during erasure (non-sensitive). */
  issues?: readonly ValidationIssue[];
}

/**
 * Enforces region/tenant residency rules for storage operations.
 * Implementations must fail closed: on error or uncertainty, return allowed=false.
 */
export type ResidencyPolicy = (
  rule: ResidencyRule,
  targetRegion: string,
  tenantId: string,
) => Promise<ResidencyCheckResult> | ResidencyCheckResult;

/**
 * Enforces erasure cascade across all stores (D1 raw, D2 vector, D4 policy)
 * with verification sweep. Implementations must fail closed: any residual
 * chunks after erasure cause ok=false.
 */
export type ErasureService = (
  request: ErasureRequest,
) => Promise<ErasureResult>;

/** Configuration for concurrency limiting (max concurrent operations). */
export interface ConcurrencyLimiterConfig {
  /** Maximum number of concurrent operations. */
  maxConcurrent: number;
  /** Maximum number of queued waiters before rejecting new requests. */
  maxQueueSize: number;
  /** Timeout in ms for waiting on concurrency slot. */
  acquireTimeoutMs: number;
}

/** Configuration for a fixed-window rate limiter. */
export interface RateLimiterConfig {
  /** Maximum number of requests allowed per window per key. */
  maxRequests: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/** Snapshot of rate limiter metrics for a single key. */
export interface RateLimiterMetrics {
  key: string;
  requestsInWindow: number;
  windowResetAt: number;
  rejected: number;
}

/** Combined per-tenant quota: request rate and token budget. */
export interface TenantQuotaConfig {
  /** Maximum requests per window for this tenant. */
  maxRequestsPerWindow: number;
  /** Maximum tokens per window for this tenant (0 = unchecked). */
  maxTokensPerWindow?: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

/** Result of a tenant quota check. */
export interface TenantQuotaCheckResult {
  /** Whether the request is allowed under quota. */
  allowed: boolean;
  /** Reason when not allowed. */
  reason?: string;
  /** Remaining requests in the current window. */
  remainingRequests?: number;
  /** Remaining tokens in the current window (if tracked). */
  remainingTokens?: number;
}

/** State of a circuit breaker. */
export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

/** Configuration for circuit breaker. */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit. */
  failureThreshold: number;
  /** Time in ms before attempting half-open recovery. */
  recoveryTimeoutMs: number;
  /** Number of successful half-open calls before closing circuit. */
  halfOpenMaxAttempts: number;
}

/** Snapshot of circuit breaker metrics. */
export interface CircuitBreakerMetrics {
  state: CircuitBreakerState;
  failures: number;
  successes: number;
  totalCalls: number;
  trips: number;
  lastFailureTime?: string;
}

/** Snapshot of concurrency limiter metrics. */
export interface ConcurrencyLimiterMetrics {
  active: number;
  queued: number;
  completed: number;
  rejected: number;
  timeouts: number;
}

/** Snapshot of cache metrics. */
export interface CacheMetrics {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

/** Combined runtime controls configuration. */
export interface RuntimeControlsConfig {
  concurrency: ConcurrencyLimiterConfig;
  circuitBreaker: CircuitBreakerConfig;
  cache: {
    maxSize: number;
    ttlMs: number;
  };
}

/** Snapshot of all runtime controls metrics. */
export interface RuntimeControlsMetrics {
  concurrency: ConcurrencyLimiterMetrics;
  circuitBreaker: CircuitBreakerMetrics;
  cache: CacheMetrics;
}

/** Cost tracking for a single embedding operation. */
export interface EmbeddingCost {
  /** Number of tokens processed. */
  tokenCount: number;
  /** Cost in USD (or provider currency). */
  cost: number;
  /** Provider-specific model name. */
  model: string;
}

/** Cost tracking for a single LLM generation operation. */
export interface GenerationCost {
  /** Number of input tokens. */
  inputTokens: number;
  /** Number of output tokens. */
  outputTokens: number;
  /** Cost in USD (or provider currency). */
  cost: number;
  /** Provider-specific model name. */
  model: string;
}

/** Cost tracking for a single ingestion operation (embedding + indexing). */
export interface IngestionCost {
  /** Number of chunks processed. */
  chunkCount: number;
  /** Total embedding cost. */
  embeddingCost: number;
  /** Total indexing/vector store write cost. */
  indexingCost: number;
  /** Total cost (embedding + indexing). */
  totalCost: number;
}

/** Cost tracking for a single query operation (embedding + retrieval + generation). */
export interface QueryCost {
  /** Embedding cost for the query. */
  embeddingCost: number;
  /** Vector search cost. */
  retrievalCost: number;
  /** Generation cost (LLM). */
  generationCost: number;
  /** Total cost (embedding + retrieval + generation). */
  totalCost: number;
}

/** Configuration for cost tracking (provider pricing). */
export interface CostConfig {
  /** Cost per 1K tokens for embedding model input. */
  embeddingCostPer1kTokens: number;
  /** Cost per 1K tokens for LLM input. */
  llmInputCostPer1kTokens: number;
  /** Cost per 1K tokens for LLM output. */
  llmOutputCostPer1kTokens: number;
  /** Cost per 1K vectors for vector store writes. */
  vectorWriteCostPer1kVectors: number;
  /** Cost per 1K vectors for vector store reads. */
  vectorReadCostPer1kVectors: number;
}

/** Aggregated cost metrics across multiple operations. */
export interface CostMetrics {
  /** Total cost in USD (or provider currency). */
  totalCost: number;
  /** Total embedding cost. */
  totalEmbeddingCost: number;
  /** Total generation cost. */
  totalGenerationCost: number;
  /** Total indexing cost. */
  totalIndexingCost: number;
  /** Total retrieval cost. */
  totalRetrievalCost: number;
  /** Cost per query (total cost / query count). */
  costPerQuery: number;
  /** Cost per ingestion (total cost / ingestion count). */
  costPerIngestion: number;
  /** Total number of queries processed. */
  queryCount: number;
  /** Total number of ingestion operations. */
  ingestionCount: number;
  /** Total number of tokens processed (embedding + generation input + output). */
  totalTokenCount: number;
}

/** Configuration for embedding drift monitoring. */
export interface EmbeddingDriftConfig {
  /** KL divergence threshold above which drift is flagged. */
  klDivergenceThreshold: number;
  /** Minimum number of samples required before a drift check is valid. */
  minSampleSize: number;
  /** Model version currently in production (the reference). */
  productionModelVersion: string;
  /** Candidate model version being evaluated. */
  candidateModelVersion: string | undefined;
}

/** Result of an embedding drift check. */
export interface EmbeddingDriftResult {
  /** Whether drift was detected (KL divergence exceeds threshold). */
  driftDetected: boolean;
  /** KL divergence value between reference and candidate distributions. */
  klDivergence: number;
  /** Threshold used for the drift check. */
  threshold: number;
  /** Reference model version. */
  referenceModelVersion: string;
  /** Candidate model version, if any. */
  candidateModelVersion: string | undefined;
  /** Timestamp when the check was performed. */
  checkedAt: string;
  /** Recommended action based on the drift result. */
  recommendedAction: 'keep' | 'rollback' | 'reindex' | 'investigate';
  /** Number of samples used in the check. */
  sampleSize: number;
}

/** A snapshot of an embedding distribution for drift comparison. */
export interface EmbeddingDistributionSnapshot {
  /** Model version that produced these embeddings. */
  modelVersion: string;
  /** Number of embeddings in the snapshot. */
  sampleSize: number;
  /** Mean of each dimension across the sample. */
  dimensionMeans: readonly number[];
  /** Variance of each dimension across the sample. */
  dimensionVariances: readonly number[];
  /** Timestamp when the snapshot was taken. */
  capturedAt: string;
}

/** Decision about which model version to use. */
export type ModelVersionDecision = 'keep' | 'rollback' | 'candidate_approved';

/** Result of a model governance evaluation. */
export interface ModelGovernanceResult {
  /** The model version decision. */
  decision: ModelVersionDecision;
  /** The model version to use after the decision. */
  selectedModelVersion: string;
  /** The previous (production) model version. */
  previousModelVersion: string;
  /** Whether a re-index is recommended. */
  reindexRecommended: boolean;
  /** Reason for the decision. */
  reason: string;
  /** Timestamp when the decision was made. */
  decidedAt: string;
}
