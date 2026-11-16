// Public entry point for the RAG pipeline (scaffold).
// Implementation will be added in later phases.

export type {
  Chunk,
  ChunkId,
  ChunkMetadata,
  Citation,
  Document,
  DocumentId,
  DocumentMetadata,
  Embedding,
  EmbeddingProviderConfig,
  EmbeddingVector,
  GeneratedAnswer,
  GenerationRequest,
  PipelineConfig,
  PipelineResponse,
  Result,
  RetrievalQuery,
  RetrievalResult,
  ValidationIssue,
} from './types.js';

export { ConfigValidationError } from './types.js';

export {
  loadPipelineConfig,
  loadPipelineConfigFromProcessEnv,
  parsePipelineConfig,
} from './config.js';

export type {
  ChunkingOptions,
  IngestBatch,
  IngestFileResult,
  ParsedDocument,
  ParseStatus,
} from './ingest.js';
export {
  chunkDocument,
  ingestSources,
  parseSourceFile,
  validateChunkingOptions,
} from './ingest.js';

export type { EmbedChunksOptions, EmbeddingCompatibility, EmbeddingProvider } from './embeddings.js';
export {
  embedChunksWithValidation,
  validateEmbeddingCompatibility,
  validateEmbeddingsForChunks,
  validateQueryEmbedding,
} from './embeddings.js';

export { HttpEmbeddingProvider } from './embedding-provider.js';

export type { LLMProviderConfig } from './types.js';
export { HttpLLMProvider } from './llm-provider.js';

export type { RetryOptions } from './resilience.js';
export { isRetryableProviderError, withRetry } from './resilience.js';

export type { IndexedRecord, VectorStore } from './vector-store.js';
export { MemoryVectorStore } from './memory-store.js';
export { QdrantStore } from './qdrant-store.js';

export type { RerankerConfig } from './types.js';
export { LexicalReranker } from './reranker.js';

export type {
  AuthorizationContext,
  AuthorizationEvaluator,
  RetrievalAuthorization,
  RetrievalReranker,
  RetrieverDependencies,
  RetrieveRequest,
} from './retrieve.js';
export { retrieve, multiSourceRRF } from './retrieve.js';

export type {
  GenerateDependencies,
  GroundedPrompt,
  LanguageModel,
  ModelGeneration,
} from './generate.js';
export {
  buildGroundedPrompt,
  citationsFromResults,
  formatEvidence,
  generateGroundedAnswer,
  insufficientContextAnswer,
} from './generate.js';

export type {
  CaseRetrievalMetrics,
  GoldenCase,
  GoldenDataset,
  GoldenDocument,
  RetrievalAggregateMetrics,
} from './eval.js';
export {
  aggregateRetrievalMetrics,
  dcgAtK,
  loadGoldenDataset,
  ndcgAtK,
  recallAtK,
  reciprocalRank,
  retrievedSourceIds,
} from './eval.js';

export type { LogEvent, LogLevel, Logger } from './observability.js';
export { createStructuredLogger, MetricsRecorder, sanitizeLogData } from './observability.js';

export type {
  QueryTransformationOptions,
  QueryTransformationResult,
  QueryTransformer,
} from './types.js';
export {
  createQueryTransformer,
  bypassQueryTransformer,
  isQueryTransformationResult,
} from './query-transform.js';

export type {
  HybridRetrievalOptions,
  SparseVector,
  SparseEmbedding,
  SparseRetrievalResult,
  SparseVectorStore,
} from './types.js';
export { SparseMemoryStore } from './sparse-store.js';

export type {
  QueryRequestBody,
  QueryResponseBody,
  ServerDependencies,
} from './server.js';
export { createHttpServer } from './server.js';

export type {
  IngestedSourceRecord,
  IngestionLifecycleResult,
  ReindexDecision,
} from './types.js';
export { IngestionLifecycleTracker } from './ingestion-lifecycle.js';

export type {
  AuditEvent,
  AuditEventType,
  AuditLog,
  AuditLogConfig,
  AuditRedactionLevel,
} from './types.js';
export { AuditLogImpl, createAuditLog } from './audit.js';

export type {
  ErasureRequest,
  ErasureResult,
  ErasureService,
  ResidencyCheckResult,
  ResidencyPolicy,
  ResidencyRule,
} from './types.js';
export { DefaultErasureService, DefaultResidencyPolicy, createErasureService, createResidencyPolicy, checkResidency } from './erasure.js';

export type {
  CostConfig,
  EmbeddingCost,
  GenerationCost,
  IngestionCost,
  QueryCost,
  CostMetrics,
} from './types.js';
export { CostMetricsTracker, DefaultCostConfig, createCostTracker } from './cost-tracking.js';
