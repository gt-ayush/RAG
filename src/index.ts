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
