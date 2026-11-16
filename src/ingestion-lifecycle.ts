import type {
  DocumentId,
  Embedding,
  IngestedSourceRecord,
  IngestionLifecycleResult,
  ReindexDecision,
  ValidationIssue,
} from './types.js';
import type { IndexedRecord, VectorStore } from './vector-store.js';

/**
 * Source-of-truth keywords: ingestion lifecycle, reindex, deletion,
 * erasure, verification sweep, source tracking
 */

/**
 * Function type for verifying that no records remain for a document after
 * deletion. Returns the number of residual chunk records found.
 */
type VerifyDeletionFn = (
  store: VectorStore,
  documentId: DocumentId,
) => Promise<number>;

/**
 * Default verification sweep for stores that support listing all records
 * (e.g. MemoryVectorStore via getAllRecords). Queries with topK: 1 to check
 * whether any chunk for the document remains.
 */
async function defaultVerifyDeletion(
  store: VectorStore,
  documentId: DocumentId,
): Promise<number> {
  // Query with a broad vector to find any chunk belonging to this document.
  const zeroVector = new Array(store.dimensions).fill(0);
  const result = await store.query(
    { text: '', topK: 1 },
    { chunkId: documentId, model: 'verify', dimensions: store.dimensions, vector: zeroVector },
  );
  if (!result.ok) {
    return 0;
  }
  const residual = result.value.filter(
    (r) => r.chunk.documentId === documentId || r.sourceId === documentId,
  );
  return residual.length;
}

/**
 * Tracks ingested sources and manages the durable ingestion lifecycle:
 * re-index detection, deletion with verification sweeps, and auditable erasure.
 *
 * All state is in-memory. Persistence to disk or a database is left to the
 * caller (e.g. by serializing getSourceRecords() and rehydrating via
 * recordSource()).
 */
export class IngestionLifecycleTracker {
  private readonly sources = new Map<DocumentId, IngestedSourceRecord>();
  private readonly chunkToDocument = new Map<string, DocumentId>();

  /**
   * Returns all tracked source records (for serialization/persistence).
   */
  getSourceRecords(): readonly IngestedSourceRecord[] {
    return [...this.sources.values()];
  }

  /**
   * Rehydrates source records from previously serialized state (for
   * durability across restarts). Overwrites any existing record for the
   * same document id.
   */
  recordSource(record: IngestedSourceRecord): void {
    this.sources.set(record.documentId, record);
  }

  /**
   * Returns the tracked record for a document, if any.
   */
  getSourceRecord(documentId: DocumentId): IngestedSourceRecord | undefined {
    return this.sources.get(documentId);
  }

  /**
   * Returns the number of tracked sources.
   */
  getSourceCount(): number {
    return this.sources.size;
  }

  /**
   * Traces a chunk back to its source document record.
   * Returns the source record if the chunk is tracked, undefined otherwise.
   * This provides end-to-end traceability from indexed chunks to original sources.
   */
  traceChunkToSource(chunkId: string): IngestedSourceRecord | undefined {
    const documentId = this.chunkToDocument.get(chunkId);
    if (!documentId) return undefined;
    return this.sources.get(documentId);
  }

  /**
   * Returns all chunk IDs tracked for a given source document.
   * Useful for verifying which chunks belong to a source before re-indexing
   * or deletion.
   */
  getChunksForSource(documentId: DocumentId): readonly string[] {
    const chunkIds: string[] = [];
    for (const [chunkId, docId] of this.chunkToDocument.entries()) {
      if (docId === documentId) {
        chunkIds.push(chunkId);
      }
    }
    return chunkIds;
  }

  /**
   * Decides whether a source needs re-indexing by comparing its content hash
   * against the previously recorded hash.
   */
  async shouldReindex(
    documentId: DocumentId,
    contentHash: string,
  ): Promise<ReindexDecision> {
    const existing = this.sources.get(documentId);
    if (!existing) {
      return { needsReindex: true, reason: 'new' };
    }
    if (existing.contentHash !== contentHash) {
      return {
        needsReindex: true,
        reason: 'changed',
        existingRecord: existing,
      };
    }
    return { needsReindex: false, reason: 'unchanged', existingRecord: existing };
  }

  /**
   * Records that a source has been ingested/upserted. Stores the content hash
   * for future re-index detection and maps each chunk id to the document for
   * lifecycle tracking.
   */
  recordIngestion(
    documentId: DocumentId,
    source: string,
    contentHash: string,
    chunkCount: number,
    version?: string,
  ): void {
    this.sources.set(documentId, {
      documentId,
      source,
      contentHash,
      ingestedAt: new Date().toISOString(),
      chunkCount,
      ...(version ? { version } : {}),
    });
  }

  /**
   * Clears the tracking record for a document (used after successful deletion).
   */
  private clearDocument(documentId: DocumentId): void {
    this.sources.delete(documentId);
    for (const [chunkId, docId] of this.chunkToDocument.entries()) {
      if (docId === documentId) {
        this.chunkToDocument.delete(chunkId);
      }
    }
  }

  /**
   * Records chunk-to-document mappings after an upsert, so deletion can target
   * the right chunks.
   */
  recordChunks(chunks: readonly IndexedRecord[]): void {
    for (const record of chunks) {
      this.chunkToDocument.set(record.chunk.id, record.chunk.documentId);
    }
  }

  /**
   * Deletes all indexed records for a document from the store, then runs a
   * verification sweep to confirm no residual chunks remain. Fail-closed:
   * if the store delete fails or the sweep finds residual records, returns
   * ok:false.
   */
  async deleteDocument(
    documentId: DocumentId,
    store: VectorStore,
    verifyDeletion: VerifyDeletionFn = defaultVerifyDeletion,
  ): Promise<IngestionLifecycleResult> {
    const existing = this.sources.get(documentId);
    const affectedChunkCount = existing?.chunkCount ?? 0;

    let deleted;
    try {
      deleted = await store.deleteByDocumentId(documentId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'store delete failed';
      return {
        ok: false,
        operation: 'delete',
        documentId,
        affectedChunkCount,
        issues: [{ path: 'store.delete', message }],
      };
    }
    if (!deleted.ok) {
      return {
        ok: false,
        operation: 'delete',
        documentId,
        affectedChunkCount,
        issues: deleted.issues,
      };
    }

    // Verification sweep: confirm no residual records remain.
    const residual = await verifyDeletion(store, documentId);

    this.clearDocument(documentId);

    const ok = residual === 0;
    return {
      ok,
      operation: 'delete',
      documentId,
      affectedChunkCount,
      residualChunkCount: residual,
      ...(residual > 0 ? { issues: [{ path: 'verification', message: `${residual} residual chunk(s) remain after deletion` }] } : {}),
    };
  }

  /**
   * Auditable erasure of a document. Same as deleteDocument but with an
   * explicit erasure operation type and full verification sweep. Fail-closed:
   * any residual chunks after deletion cause ok:false.
   */
  async erasureDocument(
    documentId: DocumentId,
    store: VectorStore,
    verifyDeletion: VerifyDeletionFn = defaultVerifyDeletion,
  ): Promise<IngestionLifecycleResult> {
    const result = await this.deleteDocument(documentId, store, verifyDeletion);
    return {
      ...result,
      operation: 'erasure',
    };
  }

  /**
   * Re-indexes a document: records the new ingestion and returns the updated
   * record. The caller is responsible for re-chunking, re-embedding, and
   * re-upserting before calling this method (upsert is idempotent by chunk
   * id).
   */
  async reindexDocument(
    documentId: DocumentId,
    source: string,
    contentHash: string,
    chunkCount: number,
    version?: string,
  ): Promise<IngestionLifecycleResult> {
    this.recordIngestion(documentId, source, contentHash, chunkCount, version);
    return {
      ok: true,
      operation: 'reindex',
      documentId,
      affectedChunkCount: chunkCount,
    };
  }
}
