import type {
  Chunk,
  DocumentId,
  RetrievalQuery,
  RetrievalResult,
  Result,
  SparseEmbedding,
  SparseRetrievalResult,
  SparseVector,
  SparseVectorStore,
  ValidationIssue,
} from './types.js';

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

/** Tokenize text into lowercase terms. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

/** Count term frequencies in a token list. */
function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) ?? 0) + 1);
  }
  return tf;
}

/** BM25 parameters. */
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * In-memory BM25 sparse vector store for local development/testing.
 *
 * Stores chunk text and computes BM25 scores at query time. Applies trusted
 * server-side tenant filtering. Supports idempotent upsert by chunk id and
 * deletion by document id.
 *
 * Source-of-truth keywords: sparse vector store, BM25, hybrid retrieval,
 * tenant filtering, idempotent upsert
 */
export class SparseMemoryStore implements SparseVectorStore {
  readonly kind = 'sparse-memory';
  private readonly records = new Map<string, { chunk: Chunk; tokens: string[]; tf: Map<string, number> }>();
  private documentFrequencies = new Map<string, number>();
  private numDocuments = 0;

  /** Query a sparse vector store using BM25 scoring. Query terms are derived
   * from `query.text`; the `sparseVector` parameter is accepted for interface
   * compatibility but not required by this implementation. */
  async query(
    query: RetrievalQuery,
    _sparseVector: SparseVector,
  ): Promise<Result<readonly SparseRetrievalResult[]>> {
    const topK = Number.isInteger(query.topK) && query.topK > 0 ? query.topK : 0;
    if (topK === 0) {
      return {
        ok: false,
        issues: [issue('query.topK', 'must be a positive integer')],
      };
    }

    const queryTerms = new Set(tokenize(query.text));

    const avgdl = this.numDocuments > 0 ? this.totalTokenLength() / this.numDocuments : 0;

    const scored: RetrievalResult[] = [];
    for (const record of this.records.values()) {
      if (query.tenantId && record.chunk.metadata.tenantId !== query.tenantId) {
        continue;
      }

      const score = this.bm25Score(record.tf, record.tokens.length, queryTerms, avgdl);
      // Only include documents that match at least one query term (score > 0).
      if (score <= 0) continue;
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

  /** Upsert records idempotently by chunk id. Rebuilds term statistics. */
  async upsert(records: readonly { chunk: Chunk; sparseEmbedding: SparseEmbedding }[]): Promise<Result<{ upserted: number }>> {
    const issues: ValidationIssue[] = [];
    for (let i = 0; i < records.length; i += 1) {
      const record = records[i];
      if (!record) continue;
      const p = `records[${i}]`;
      if (record.sparseEmbedding.chunkId !== record.chunk.id) {
        issues.push(issue(`${p}`, 'sparseEmbedding.chunkId must match chunk.id'));
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
      const tokens = tokenize(record.chunk.content);
      this.records.set(record.chunk.id, {
        chunk: structuredClone(record.chunk),
        tokens,
        tf: termFrequencies(tokens),
      });
    }

    this.rebuildStatistics();
    return { ok: true, value: { upserted: records.length } };
  }

  /** Delete all chunks for a document id. */
  async deleteByDocumentId(documentId: DocumentId): Promise<Result<{ deleted: number }>> {
    let deleted = 0;
    for (const [chunkId, record] of this.records.entries()) {
      if (record.chunk.documentId === documentId) {
        this.records.delete(chunkId);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      this.rebuildStatistics();
    }
    return { ok: true, value: { deleted } };
  }

  /** Rebuild document frequency statistics from current records. */
  private rebuildStatistics(): void {
    this.documentFrequencies = new Map();
    this.numDocuments = this.records.size;

    for (const record of this.records.values()) {
      const uniqueTerms = new Set(record.tokens);
      for (const term of uniqueTerms) {
        this.documentFrequencies.set(term, (this.documentFrequencies.get(term) ?? 0) + 1);
      }
    }
  }

  /** Total token length across all documents. */
  private totalTokenLength(): number {
    let total = 0;
    for (const record of this.records.values()) {
      total += record.tokens.length;
    }
    return total;
  }

  /** Compute BM25 score for a document given query terms. */
  private bm25Score(
    tf: Map<string, number>,
    docLength: number,
    queryTerms: Set<string>,
    avgdl: number,
  ): number {
    let score = 0;
    const N = this.numDocuments;
    for (const term of queryTerms) {
      const ftd = tf.get(term) ?? 0;
      if (ftd === 0) continue;

      const n = this.documentFrequencies.get(term) ?? 0;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);

      const numerator = ftd * (BM25_K1 + 1);
      const denominator = ftd + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / avgdl));
      score += idf * (numerator / denominator);
    }
    return score;
  }

  /** Test/helper visibility into stored records. */
  getAllRecords(): readonly { chunk: Chunk; sparseEmbedding: SparseEmbedding }[] {
    return [...this.records.values()].map((r) => ({
      chunk: structuredClone(r.chunk),
      sparseEmbedding: {
        chunkId: r.chunk.id,
        model: 'bm25',
        sparseVector: {
          indices: [...r.tf.keys()].map((_, i) => i),
          values: [...r.tf.values()],
        },
      },
    }));
  }

  /** Number of unique documents indexed. */
  documentCount(): number {
    return this.numDocuments;
  }
}
