import { describe, expect, it, vi } from 'vitest';
import { MemoryVectorStore } from '../src/memory-store.js';
import { IngestionLifecycleTracker } from '../src/ingestion-lifecycle.js';
import type { Chunk, Embedding, IndexedRecord } from '../src/types.js';

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

function makeRecord(id: string, docId: string, vector: number[]): IndexedRecord {
  return { chunk: makeChunk(id, docId), embedding: makeEmbedding(id, vector) };
}

describe('IngestionLifecycleTracker', () => {
  it('shouldReindex returns true for a new source', async () => {
    const tracker = new IngestionLifecycleTracker();
    const decision = await tracker.shouldReindex('doc-1', 'hash-a');
    expect(decision.needsReindex).toBe(true);
    expect(decision.reason).toBe('new');
    expect(decision.existingRecord).toBeUndefined();
  });

  it('shouldReindex returns false for an unchanged source', async () => {
    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 3);
    const decision = await tracker.shouldReindex('doc-1', 'hash-a');
    expect(decision.needsReindex).toBe(false);
    expect(decision.reason).toBe('unchanged');
    expect(decision.existingRecord?.contentHash).toBe('hash-a');
  });

  it('shouldReindex returns true when content hash changed', async () => {
    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 3);
    const decision = await tracker.shouldReindex('doc-1', 'hash-b');
    expect(decision.needsReindex).toBe(true);
    expect(decision.reason).toBe('changed');
    expect(decision.existingRecord?.contentHash).toBe('hash-a');
  });

  it('recordIngestion and getSourceRecords track sources', async () => {
    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 3, 'v1');
    tracker.recordIngestion('doc-2', '/path/doc-2.txt', 'hash-b', 2);

    const records = tracker.getSourceRecords();
    expect(records).toHaveLength(2);
    expect(records.find((r) => r.documentId === 'doc-1')?.chunkCount).toBe(3);
    expect(records.find((r) => r.documentId === 'doc-1')?.version).toBe('v1');
    expect(records.find((r) => r.documentId === 'doc-2')?.ingestedAt).toBeDefined();
  });

  it('getSourceRecord returns undefined for unknown document', async () => {
    const tracker = new IngestionLifecycleTracker();
    expect(tracker.getSourceRecord('doc-999')).toBeUndefined();
  });

  it('deleteDocument removes store records and clears tracking', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
      makeRecord('d1::chunk::1', 'doc-1', [0, 1]),
      makeRecord('d2::chunk::0', 'doc-2', [1, 1]),
    ]);

    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 2);
    tracker.recordIngestion('doc-2', '/path/doc-2.txt', 'hash-b', 1);
    tracker.recordChunks([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
      makeRecord('d1::chunk::1', 'doc-1', [0, 1]),
      makeRecord('d2::chunk::0', 'doc-2', [1, 1]),
    ]);

    const result = await tracker.deleteDocument('doc-1', store);

    expect(result.ok).toBe(true);
    expect(result.operation).toBe('delete');
    expect(result.documentId).toBe('doc-1');
    expect(result.affectedChunkCount).toBe(2);
    expect(result.residualChunkCount).toBe(0);
    expect(tracker.getSourceRecord('doc-1')).toBeUndefined();
    expect(tracker.getSourceRecord('doc-2')).toBeDefined();

    const remaining = store.getAllRecords();
    expect(remaining.map((r) => r.chunk.documentId)).not.toContain('doc-1');
  });

  it('deleteDocument returns ok:false when store delete fails', async () => {
    const store = new MemoryVectorStore(2);
    const originalDelete = store.deleteByDocumentId.bind(store);
    vi.spyOn(store, 'deleteByDocumentId').mockRejectedValueOnce(new Error('store down'));

    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 2);

    const result = await tracker.deleteDocument('doc-1', store);

    expect(result.ok).toBe(false);
    expect(result.operation).toBe('delete');
    expect(result.issues).toHaveLength(1);
    // Tracking should NOT be cleared on failure
    expect(tracker.getSourceRecord('doc-1')).toBeDefined();
    // Restore
    vi.spyOn(store, 'deleteByDocumentId').mockImplementation(originalDelete);
  });

  it('deleteDocument verification sweep detects residual chunks', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
      makeRecord('d2::chunk::0', 'doc-2', [1, 1]),
    ]);

    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 1);
    tracker.recordIngestion('doc-2', '/path/doc-2.txt', 'hash-b', 1);
    tracker.recordChunks([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
      makeRecord('d2::chunk::0', 'doc-2', [1, 1]),
    ]);

    // Custom verify that always finds 1 residual (simulating incomplete deletion)
    const result = await tracker.deleteDocument('doc-1', store, async () => 1);

    expect(result.ok).toBe(false);
    expect(result.residualChunkCount).toBe(1);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.path).toBe('verification');
  });

  it('erasureDocument marks operation as erasure', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([makeRecord('d1::chunk::0', 'doc-1', [1, 0])]);

    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 1);
    tracker.recordChunks([makeRecord('d1::chunk::0', 'doc-1', [1, 0])]);

    const result = await tracker.erasureDocument('doc-1', store);

    expect(result.ok).toBe(true);
    expect(result.operation).toBe('erasure');
    expect(result.residualChunkCount).toBe(0);
  });

  it('reindexDocument records updated ingestion', async () => {
    const tracker = new IngestionLifecycleTracker();
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 2, 'v1');

    const result = await tracker.reindexDocument(
      'doc-1',
      '/path/doc-1.txt',
      'hash-b',
      4,
      'v2',
    );

    expect(result.ok).toBe(true);
    expect(result.operation).toBe('reindex');
    expect(result.affectedChunkCount).toBe(4);

    const record = tracker.getSourceRecord('doc-1');
    expect(record?.contentHash).toBe('hash-b');
    expect(record?.chunkCount).toBe(4);
    expect(record?.version).toBe('v2');
  });

  it('getSourceCount returns correct count', async () => {
    const tracker = new IngestionLifecycleTracker();
    expect(tracker.getSourceCount()).toBe(0);
    tracker.recordIngestion('doc-1', '/path/doc-1.txt', 'hash-a', 1);
    tracker.recordIngestion('doc-2', '/path/doc-2.txt', 'hash-b', 1);
    expect(tracker.getSourceCount()).toBe(2);
    await tracker.deleteDocument('doc-1', new MemoryVectorStore(2));
    expect(tracker.getSourceCount()).toBe(1);
  });
});
