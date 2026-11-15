import type { Embedding, RetrievalQuery, RetrievalResult, Result, ValidationIssue } from './types.js';
import type { IndexedRecord, VectorStore } from './vector-store.js';

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function cosineSimilarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Minimal in-memory vector store for local development/testing.
 * Preserves chunk/source metadata and supports idempotent upsert by chunk id.
 */
export class MemoryVectorStore implements VectorStore {
  readonly kind = 'memory';
  readonly dimensions: number;
  private readonly records = new Map<string, IndexedRecord>();

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  async upsert(records: readonly IndexedRecord[]): Promise<Result<{ upserted: number }>> {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const p = `records[${i}]`;
      if (record.embedding.dimensions !== this.dimensions) {
        issues.push(
          issue(
            `${p}.embedding.dimensions`,
            `store dimension mismatch: expected ${this.dimensions} but received ${record.embedding.dimensions}`,
          ),
        );
      }
      if (record.embedding.vector.length !== this.dimensions) {
        issues.push(
          issue(
            `${p}.embedding.vector`,
            `vector length mismatch: expected ${this.dimensions} but received ${record.embedding.vector.length}`,
          ),
        );
      }
      if (record.embedding.chunkId !== record.chunk.id) {
        issues.push(issue(`${p}`, 'embedding.chunkId must match chunk.id'));
      }
      if (record.chunk.metadata.chunkId !== record.chunk.id) {
        issues.push(issue(`${p}.chunk.metadata.chunkId`, 'chunk metadata.chunkId must match chunk.id'));
      }
      if (record.chunk.documentId !== record.chunk.metadata.documentId) {
        issues.push(issue(`${p}.chunk`, 'chunk documentId must match chunk metadata.documentId'));
      }
    }
    if (issues.length > 0) return { ok: false, issues };

    for (const record of records) {
      // Idempotent upsert: replace existing record for same chunk id.
      this.records.set(record.chunk.id, {
        chunk: structuredClone(record.chunk),
        embedding: {
          ...record.embedding,
          vector: [...record.embedding.vector],
        },
      });
    }
    return { ok: true, value: { upserted: records.length } };
  }

  async query(
    query: RetrievalQuery,
    queryEmbedding: Embedding,
  ): Promise<Result<readonly RetrievalResult[]>> {
    if (queryEmbedding.dimensions !== this.dimensions || queryEmbedding.vector.length !== this.dimensions) {
      return {
        ok: false,
        issues: [
          issue(
            'queryEmbedding',
            `query embedding dimension mismatch: expected ${this.dimensions}`,
          ),
        ],
      };
    }

    const topK = Number.isInteger(query.topK) && query.topK > 0 ? query.topK : 0;
    if (topK === 0) {
      return {
        ok: false,
        issues: [issue('query.topK', 'must be a positive integer')],
      };
    }

    const scored: RetrievalResult[] = [];
    for (const record of this.records.values()) {
      if (query.tenantId && record.chunk.metadata.tenantId !== query.tenantId) {
        continue;
      }
      const score = cosineSimilarity(queryEmbedding.vector, record.embedding.vector);
      scored.push({
        chunk: structuredClone(record.chunk),
        score,
        rank: 0,
        sourceId: record.chunk.documentId,
      });
    }

    scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
    const limited = scored.slice(0, topK).map((r, idx) => ({ ...r, rank: idx + 1 }));
    return { ok: true, value: limited };
  }

  async deleteByDocumentId(documentId: string): Promise<Result<{ deleted: number }>> {
    let deleted = 0;
    for (const [chunkId, record] of this.records.entries()) {
      if (record.chunk.documentId === documentId) {
        this.records.delete(chunkId);
        deleted += 1;
      }
    }
    return { ok: true, value: { deleted } };
  }

  /** Test/helper visibility into stored records (traceability/lifecycle checks). */
  getAllRecords(): readonly IndexedRecord[] {
    return [...this.records.values()].map((r) => ({
      chunk: structuredClone(r.chunk),
      embedding: { ...r.embedding, vector: [...r.embedding.vector] },
    }));
  }
}
