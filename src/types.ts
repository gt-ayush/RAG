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
