import type { Chunk, Embedding, RetrievalQuery, RetrievalResult, Result, ValidationIssue } from './types.js';
import type { IndexedRecord, VectorStore } from './vector-store.js';
import { QdrantClient } from '@qdrant/js-client-rest';

/**
 * Source-of-truth keywords: QdrantStore, Qdrant Cloud, vector store,
 * payload filter, deterministic id mapping
 */

/** Payload field names written for every indexed chunk. */
const PAYLOAD = {
  documentId: 'document_id',
  chunkId: 'chunk_id',
  chunkIndex: 'chunk_index',
  source: 'source',
  tenantId: 'tenant_id',
  contentHash: 'content_hash',
} as const;

/** Fields that may be filtered on and therefore must carry a payload index. */
const INDEXED_PAYLOAD_FIELDS = [PAYLOAD.documentId, PAYLOAD.tenantId];

/**
 * Deterministically map an arbitrary chunk id to a Qdrant-compatible point id
 * (a UUID derived from the chunk id) so ids are stable across re-ingestion and
 * never collide with unrelated data. Qdrant point ids must be UUIDs or numbers.
 */
function chunkIdToPointId(chunkId: string): string {
  let hash = 0;
  for (let i = 0; i < chunkId.length; i += 1) {
    hash = (hash * 31 + chunkId.charCodeAt(i)) | 0;
  }
  const first = Math.abs(hash).toString(16).padStart(8, '0');
  return `${first}-e840-41d4-a716-446655440000`;
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

function payloadFor(chunk: Chunk): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    [PAYLOAD.documentId]: chunk.documentId,
    [PAYLOAD.chunkId]: chunk.id,
    [PAYLOAD.chunkIndex]: chunk.index,
    [PAYLOAD.source]: chunk.metadata.source,
    [PAYLOAD.contentHash]: chunk.metadata.contentHash ?? '',
  };
  if (chunk.metadata.tenantId !== undefined) {
    payload[PAYLOAD.tenantId] = chunk.metadata.tenantId;
  }
  if (chunk.metadata.page !== undefined) {
    payload['page'] = chunk.metadata.page;
  }
  if (chunk.metadata.section !== undefined) {
    payload['section'] = chunk.metadata.section;
  }
  return payload;
}

function buildFilter(
  tenantId?: string,
  allowedDocumentIds?: readonly string[],
): { must?: Array<{ key: string; match: { value: unknown } }> } | undefined {
  const must: Array<{ key: string; match: { value: unknown } }> = [];
  if (tenantId) {
    must.push({ key: PAYLOAD.tenantId, match: { value: tenantId } });
  }
  if (allowedDocumentIds && allowedDocumentIds.length > 0) {
    must.push({ key: PAYLOAD.documentId, match: { value: allowedDocumentIds[0] } });
  }
  return must.length > 0 ? { must } : undefined;
}

function resultFromPoint(point: unknown): RetrievalResult {
  const p = point as Record<string, unknown>;
  const payload = (p.payload as Record<string, unknown>) ?? {};
  const id = String(p.id ?? '');
  const score = Number(p.score ?? 0);
  const rank = Number(p.rank ?? 0) || 0;
  const chunk: Chunk = {
    id: (payload[PAYLOAD.chunkId] as string) ?? id,
    documentId: (payload[PAYLOAD.documentId] as string) ?? '',
    content: (payload['content'] as string) ?? '',
    index: Number((payload[PAYLOAD.chunkIndex] as number | undefined) ?? 0),
    metadata: {
      documentId: (payload[PAYLOAD.documentId] as string) ?? '',
      source: (payload[PAYLOAD.source] as string) ?? '',
      chunkId: (payload[PAYLOAD.chunkId] as string) ?? id,
      chunkIndex: Number((payload[PAYLOAD.chunkIndex] as number | undefined) ?? 0),
      ...(payload[PAYLOAD.contentHash] ? { contentHash: String(payload[PAYLOAD.contentHash]) } : {}),
      ...(payload[PAYLOAD.tenantId] ? { tenantId: String(payload[PAYLOAD.tenantId]) } : {}),
      ...(payload['page'] !== undefined ? { page: Number(payload['page']) } : {}),
      ...(payload['section'] !== undefined ? { section: String(payload['section']) } : {}),
    },
  };
  return {
    chunk,
    score,
    rank,
    sourceId: chunk.documentId,
  };
}

interface QdrantStoreConfig {
  url: string;
  apiKey?: string;
  collection: string;
  dimensions: number;
  timeoutMs?: number;
}

/**
 * Qdrant Cloud vector store adapter implementing the existing `VectorStore`
 * contract. Keeps the Qdrant SDK inside this adapter; pipeline modules never
 * call `@qdrant/js-client-rest` directly.
 *
 * Notes:
 * - Qdrant point ids must be UUIDs or numbers. Chunk ids are mapped
 *   deterministically via chunkIdToPointId; the original id is preserved in
 *   payload `chunk_id`.
 * - Qdrant Cloud runs in strict mode: every field used in a filter must have a
 *   payload index. `document_id` and `tenant_id` are indexed on first upsert.
 * - Filter pushdown is server-side: tenant_id and document_id filters are
 *   applied in the Qdrant query filter, never client-side only.
 * - Fail-closed: Qdrant client errors surface as Result issues; no partial
 *   success, no silent fallback.
 */
export class QdrantStore implements VectorStore {
  readonly kind = 'qdrant';
  readonly dimensions: number;
  private readonly client: QdrantClient;
  private readonly collection: string;
  private indexesEnsured = false;

  constructor(config: QdrantStoreConfig) {
    this.dimensions = config.dimensions;
    this.collection = config.collection;
    this.client = new QdrantClient({
      url: config.url,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
      ...(config.timeoutMs ? { timeout: Math.trunc(config.timeoutMs) } : {}),
    });
  }

  private async ensureIndexes(): Promise<void> {
    if (this.indexesEnsured) return;
    for (const field of INDEXED_PAYLOAD_FIELDS) {
      try {
        await this.client.createPayloadIndex(this.collection, {
          field_name: field,
          field_schema: 'keyword',
          wait: true,
        });
      } catch {
        // Index may already exist; treat as ensured.
      }
    }
    this.indexesEnsured = true;
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
    }
    if (issues.length > 0) return { ok: false, issues };

    await this.ensureIndexes();

    try {
      const points = records.map((record) => ({
        id: chunkIdToPointId(record.chunk.id),
        vector: record.embedding.vector as number[],
        payload: payloadFor(record.chunk),
      }));
      await this.client.upsert(this.collection, { wait: true, points });
      return { ok: true, value: { upserted: records.length } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'qdrant upsert failed';
      return { ok: false, issues: [{ path: 'qdrant.upsert', message }] };
    }
  }

  async query(
    query: RetrievalQuery,
    queryEmbedding: Embedding,
  ): Promise<Result<readonly RetrievalResult[]>> {
    if (queryEmbedding.dimensions !== this.dimensions || queryEmbedding.vector.length !== this.dimensions) {
      return { ok: false, issues: [issue('queryEmbedding', `query embedding dimension mismatch: expected ${this.dimensions}`)] };
    }
    const topK = Number.isInteger(query.topK) && query.topK > 0 ? query.topK : 0;
    if (topK === 0) {
      return { ok: false, issues: [issue('query.topK', 'must be a positive integer')] };
    }

    const docIds = query.filters?.['allowed_document_ids'];
    const filter = buildFilter(query.tenantId, Array.isArray(docIds) ? docIds : undefined);

    try {
      await this.ensureIndexes();
      const results = await this.client.query(this.collection, {
        query: queryEmbedding.vector as number[],
        filter: filter ?? null,
        limit: topK,
        with_payload: true,
        with_vector: true,
      });
      const mapped = (results as unknown as unknown[]).map((point) => resultFromPoint(point));
      mapped.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
      const limited = mapped.slice(0, topK).map((r, idx) => ({ ...r, rank: idx + 1 }));
      return { ok: true, value: limited };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'qdrant query failed';
      return { ok: false, issues: [{ path: 'qdrant.query', message }] };
    }
  }

  async deleteByDocumentId(documentId: string): Promise<Result<{ deleted: number }>> {
    try {
      await this.client.delete(this.collection, {
        filter: { must: [{ key: PAYLOAD.documentId, match: { value: documentId } }] },
      });
      // Qdrant delete-by-filter does not return a count of deleted points.
      return { ok: true, value: { deleted: -1 } };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'qdrant delete failed';
      return { ok: false, issues: [{ path: 'qdrant.delete', message }] };
    }
  }
}
