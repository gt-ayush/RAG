import type {
  DocumentId,
  DocumentMetadata,
  DocumentMetadataFilter,
  DocumentMetadataStore,
  Result,
  ValidationIssue,
} from './types.js';

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

/**
 * In-memory implementation of DocumentMetadataStore.
 * Provides in-memory storage of document metadata with deterministic,
 * idempotent upsert by documentId. Suitable for local development,
 * testing, and as a reference implementation for persistent adapters.
 *
 * Source-of-truth keywords: document metadata store, document metadata,
 * document store, metadata store, in-memory store
 */
export class DocumentMemoryStore implements DocumentMetadataStore {
  readonly kind = 'document-memory';
  private readonly documents = new Map<DocumentId, DocumentMetadata>();

  /**
   * Store or update document metadata. Idempotent by documentId.
   */
  async upsert(documents: readonly DocumentMetadata[]): Promise<Result<{ count: number }>> {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < documents.length; i += 1) {
      const doc = documents[i];
      if (!doc) continue;
      const p = `documents[${i}]`;
      if (!doc.documentId || doc.documentId.trim().length === 0) {
        issues.push({ path: `${p}.documentId`, message: 'documentId is required' });
      }
      if (!doc.source || doc.source.trim().length === 0) {
        issues.push({ path: `${p}.source`, message: 'source is required' });
      }
    }
    if (issues.length > 0) {
      return { ok: false, issues };
    }

    for (const doc of documents) {
      this.documents.set(doc.documentId, { ...doc });
    }
    return { ok: true, value: { count: documents.length } };
  }

  /**
   * Query documents with optional filtering.
   */
  async query(
    filters?: DocumentMetadataFilter,
  ): Promise<Result<readonly DocumentMetadata[]>> {
    let results = Array.from(this.documents.values());

    if (filters) {
      if (filters.tenantId !== undefined) {
        results = results.filter((d) => d.tenantId === filters.tenantId);
      }
      if (filters.source !== undefined) {
        results = results.filter((d) => d.source === filters.source);
      }
      if (filters.status !== undefined) {
        results = results.filter((d) => d.attributes?.status === filters.status);
      }
      if (filters.documentIds && filters.documentIds.length > 0) {
        const allowed = new Set(filters.documentIds);
        results = results.filter((d) => allowed.has(d.documentId));
      }
    }

    return { ok: true, value: results };
  }

  /**
   * Delete a document and its metadata by document ID.
   */
  async deleteByDocumentId(documentId: DocumentId): Promise<Result<{ count: number }>> {
    const existed = this.documents.delete(documentId);
    return { ok: true, value: { count: existed ? 1 : 0 } };
  }

  /**
   * Delete multiple documents by document ID.
   */
  async deleteByDocumentIds(documentIds: readonly DocumentId[]): Promise<Result<{ count: number }>> {
    let deleted = 0;
    for (const docId of documentIds) {
      if (this.documents.delete(docId)) {
        deleted += 1;
      }
    }
    return { ok: true, value: { count: deleted } };
  }

  /**
   * Count documents matching optional filters.
   */
  async count(filters?: DocumentMetadataFilter): Promise<number> {
    const result = await this.query(filters);
    if (!result.ok) return 0;
    return result.value.length;
  }

  /**
   * Get all documents (for admin/debugging).
   */
  getAll(): readonly DocumentMetadata[] {
    return [...this.documents.values()].map((d) => ({ ...d }));
  }
}
