import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QdrantClient } from '@qdrant/js-client-rest';
import { QdrantStore } from '../src/qdrant-store.js';
import type { Chunk, Embedding, IndexedRecord } from '../src/types.js';

const QDRANT_URL = 'https://example-cluster.eu-central.aws.cloud.qdrant.io';
const QDRANT_API_KEY = 'test-api-key';
const COLLECTION = 'test-collection';
const DIMENSIONS = 3;

function makeChunk(id: string, docId: string, content = 'content'): Chunk {
  return {
    id,
    documentId: docId,
    content,
    index: 0,
    metadata: {
      documentId: docId,
      source: `${docId}.txt`,
      chunkId: id,
      chunkIndex: 0,
      contentHash: 'hash',
      tenantId: 'tenant-a',
    },
  };
}

function makeEmbedding(id: string, vector: number[]): Embedding {
  return {
    chunkId: id,
    model: 'test-embed',
    dimensions: vector.length,
    vector,
  };
}

function makeRecord(id: string, docId: string, vector: number[], content = 'content'): IndexedRecord {
  return { chunk: makeChunk(id, docId, content), embedding: makeEmbedding(id, vector) };
}

function mockQdrantMethods() {
  const upsert = vi.spyOn(QdrantClient.prototype, 'upsert').mockResolvedValue({});
  const query = vi
    .spyOn(QdrantClient.prototype, 'query')
    .mockResolvedValue([
      {
        id: 'point-1',
        score: 0.9,
        rank: 0,
        payload: {
          document_id: 'd1',
          chunk_id: 'd1::chunk::0',
          chunk_index: 0,
          source: 'd1.txt',
          tenant_id: 'tenant-a',
          content_hash: 'hash',
          content: 'content',
        },
        vector: [0.1, 0.2, 0.3],
      },
    ]);
  const deleteFn = vi.spyOn(QdrantClient.prototype, 'delete').mockResolvedValue({});
  const createPayloadIndex = vi
    .spyOn(QdrantClient.prototype, 'createPayloadIndex')
    .mockResolvedValue({});
  return { upsert, query, delete: deleteFn, createPayloadIndex };
}

describe('QdrantStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exposes kind and dimensions', () => {
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });
    expect(store.kind).toBe('qdrant');
    expect(store.dimensions).toBe(DIMENSIONS);
  });

  it('upserts records and returns upserted count', async () => {
    const { upsert } = mockQdrantMethods();
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    const records = [makeRecord('d1::chunk::0', 'd1', [1, 0, 0]), makeRecord('d1::chunk::1', 'd1', [0, 1, 0])];
    const result = await store.upsert(records);

    expect(result).toEqual({ ok: true, value: { upserted: 2 } });
    expect(upsert).toHaveBeenCalledTimes(1);
    const call = upsert.mock.calls[0];
    expect(call[0]).toBe(COLLECTION);
    expect(call[1]?.wait).toBe(true);
    expect(call[1]?.points).toHaveLength(2);
    expect(call[1]?.points[0]?.id).toBeDefined();
    expect(call[1]?.points[0]?.payload?.document_id).toBe('d1');
    expect(call[1]?.points[0]?.payload?.tenant_id).toBe('tenant-a');
    expect(call[1]?.points[0]?.vector).toEqual([1, 0, 0]);
  });

  it('rejects dimension-mismatched upserts', async () => {
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });
    const bad = makeRecord('d1::chunk::0', 'd1', [1, 0]); // 2 dims, store expects 3
    const result = await store.upsert([bad]);
    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues.some((i) => i.path.includes('dimensions'))).toBe(true);
  });

  it('queries and returns traceable ranked results', async () => {
    const { query } = mockQdrantMethods();
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    const result = await store.query(
      { text: 'q', topK: 2 },
      { chunkId: 'q', model: 'test-embed', dimensions: DIMENSIONS, vector: [0.1, 0.2, 0.3] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.chunk.id).toBe('d1::chunk::0');
    expect(result.value[0]?.sourceId).toBe('d1');
    expect(result.value[0]?.rank).toBe(1);
    expect(query).toHaveBeenCalledTimes(1);
    const call = query.mock.calls[0];
    expect(call[0]).toBe(COLLECTION);
    expect(call[1]?.limit).toBe(2);
    expect(call[1]?.with_payload).toBe(true);
    expect(call[1]?.with_vector).toBe(true);
  });

  it('applies tenant filter in the qdrant query filter', async () => {
    const { query } = mockQdrantMethods();
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    await store.query(
      { text: 'q', topK: 5, tenantId: 'tenant-a' },
      { chunkId: 'q', model: 'test-embed', dimensions: DIMENSIONS, vector: [0.1, 0.2, 0.3] },
    );

    const call = query.mock.calls[0];
    expect(call[1]?.filter).toEqual({
      must: [{ key: 'tenant_id', match: { value: 'tenant-a' } }],
    });
  });

  it('applies allowed document ids filter in the qdrant query filter', async () => {
    const { query } = mockQdrantMethods();
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    await store.query(
      { text: 'q', topK: 5, filters: { allowed_document_ids: ['d1', 'd2'] } },
      { chunkId: 'q', model: 'test-embed', dimensions: DIMENSIONS, vector: [0.1, 0.2, 0.3] },
    );

    const call = query.mock.calls[0];
    expect(call[1]?.filter).toEqual({
      must: [{ key: 'document_id', match: { value: 'd1' } }],
    });
  });

  it('rejects dimension-mismatched queries', async () => {
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });
    const result = await store.query(
      { text: 'q', topK: 1 },
      { chunkId: 'q', model: 'test-embed', dimensions: 2, vector: [1, 0] },
    );
    expect(result.ok).toBe(false);
  });

  it('deletes by document id', async () => {
    const { delete: deleteFn } = mockQdrantMethods();
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    const result = await store.deleteByDocumentId('d1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deleted).toBe(-1);
    expect(deleteFn).toHaveBeenCalledTimes(1);
    expect(deleteFn.mock.calls[0][0]).toBe(COLLECTION);
    expect(deleteFn.mock.calls[0][1]?.filter).toEqual({
      must: [{ key: 'document_id', match: { value: 'd1' } }],
    });
  });

  it('surfaces qdrant errors as Result issues without leaking internals', async () => {
    const { upsert } = mockQdrantMethods();
    upsert.mockRejectedValueOnce(new Error('connection refused'));
    const store = new QdrantStore({ url: QDRANT_URL, apiKey: QDRANT_API_KEY, collection: COLLECTION, dimensions: DIMENSIONS });

    const result = await store.upsert([makeRecord('d1::chunk::0', 'd1', [1, 0, 0])]);
    expect(result.ok).toBe(false);
    if (!result.ok) return;
    expect(result.issues[0]?.path).toBe('qdrant.upsert');
    expect(JSON.stringify(result.issues)).not.toContain(QDRANT_API_KEY);
  });
});
