import type { Chunk, Embedding, RetrievalQuery, RetrievalResult, Result } from './types.js';

export interface IndexedRecord {
  chunk: Chunk;
  embedding: Embedding;
}

export interface VectorStore {
  readonly kind: string;
  readonly dimensions: number;
  /** Upsert/index records idempotently by chunk id where supported. */
  upsert(records: readonly IndexedRecord[]): Promise<Result<{ upserted: number }>>;
  /** Retrieve relevant chunks; must apply trusted server-side filters before returning. */
  query(query: RetrievalQuery, queryEmbedding: Embedding): Promise<Result<readonly RetrievalResult[]>>;
  /** Delete indexed records for a source/document id where supported. */
  deleteByDocumentId(documentId: string): Promise<Result<{ deleted: number }>>;
}
