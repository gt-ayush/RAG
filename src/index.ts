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

export type { RetryOptions } from './resilience.js';
export { isRetryableProviderError, withRetry } from './resilience.js';

export type { IndexedRecord, VectorStore } from './vector-store.js';
export { MemoryVectorStore } from './memory-store.js';

export type {
  AuthorizationContext,
  AuthorizationEvaluator,
  RetrievalAuthorization,
  RetrievalReranker,
  RetrieverDependencies,
  RetrieveRequest,
} from './retrieve.js';
export { retrieve } from './retrieve.js';

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
