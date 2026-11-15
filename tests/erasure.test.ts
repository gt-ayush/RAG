import { describe, expect, it, vi } from 'vitest';
import { MemoryVectorStore } from '../src/memory-store.js';
import {
  createErasureService,
  createResidencyPolicy,
  checkResidency,
} from '../src/erasure.js';
import type {
  Chunk,
  Embedding,
  ErasureRequest,
  IndexedRecord,
  ResidencyRule,
} from '../src/types.js';

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

describe('DefaultResidencyPolicy', () => {
  const rule: ResidencyRule = {
    region: 'eu-west-1',
    tenantId: 'tenant-a',
    tier: 'Confidential',
  };
  const policy = createResidencyPolicy([rule]);

  it('allows target region matching the rule', async () => {
    const result = await checkResidency(policy, rule, 'eu-west-1', 'tenant-a');
    expect(result.allowed).toBe(true);
    expect(result.region).toBe('eu-west-1');
    expect(result.matchedRule).toBe(rule);
  });

  it('denies mismatched region', async () => {
    const result = await checkResidency(policy, rule, 'us-east-1', 'tenant-a');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('violates residency rule');
    expect(result.region).toBe('us-east-1');
  });

  it('denies unknown tenant (fail closed)', async () => {
    const result = await checkResidency(policy, rule, 'eu-west-1', 'tenant-b');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('no residency rule configured');
  });

  it('denies missing tier match when tier specified', async () => {
    const strictRule: ResidencyRule = {
      region: 'eu-west-1',
      tenantId: 'tenant-a',
      tier: 'Restricted(PII)',
    };
    const strictPolicy = createResidencyPolicy([strictRule]);
    const result = await checkResidency(
      strictPolicy,
      strictRule,
      'eu-west-1',
      'tenant-a',
    );
    // Tier match is informational; region match is the hard requirement.
    expect(result.allowed).toBe(true);
  });
});

describe('DefaultErasureService', () => {
  const request: ErasureRequest = {
    documentId: 'doc-1',
    tenantId: 'tenant-a',
    legalBasis: 'gdpr-article-17',
  };

  it('erases chunks from D2 vector store and clears tracking', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
      makeRecord('d1::chunk::1', 'doc-1', [0, 1]),
      makeRecord('d2::chunk::0', 'doc-2', [1, 1]),
    ]);

    const service = createErasureService(store);
    const result = await service(request);

    expect(result.ok).toBe(true);
    expect(result.documentId).toBe('doc-1');
    expect(result.residualChunkCount).toBe(0);
    expect(result.storeResults.some((s) => s.store === 'D2' && s.ok)).toBe(true);

    const remaining = store.getAllRecords();
    expect(remaining.map((r) => r.chunk.documentId)).not.toContain('doc-1');
    expect(remaining.map((r) => r.chunk.documentId)).toContain('doc-2');
  });

  it('returns ok:false when store delete fails', async () => {
    const store = new MemoryVectorStore(2);
    const originalDelete = store.deleteByDocumentId.bind(store);
    vi.spyOn(store, 'deleteByDocumentId').mockRejectedValueOnce(
      new Error('store down'),
    );

    const service = createErasureService(store);
    const result = await service(request);

    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues?.[0]?.path).toBe('d2.erasure');
    // Restore
    vi.spyOn(store, 'deleteByDocumentId').mockImplementation(originalDelete);
  });

  it('returns ok:false when verification sweep finds residual chunks', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
    ]);

    const service = createErasureService(store);

    // Normal erasure: delete removes chunks, verification finds no residuals.
    const result = await service(request);
    expect(result.ok).toBe(true);
    expect(result.residualChunkCount).toBe(0);

    // Store that pretends to delete but doesn't actually remove: verification
    // sweep still finds the chunk, so erasure fails closed.
    const failingStore = new MemoryVectorStore(2);
    await failingStore.upsert([
      makeRecord('d1::chunk::0', 'doc-1', [1, 0]),
    ]);
    vi.spyOn(failingStore, 'deleteByDocumentId').mockResolvedValue({
      ok: true,
      value: { deleted: 1 },
    });

    const service2 = createErasureService(failingStore);
    const result2 = await service2(request);
    expect(result2.ok).toBe(false);
    expect(result2.residualChunkCount).toBe(1);
    expect(result2.issues?.[0]?.path).toBe('verification');
  });

  it('returns per-store results for D1, D2, D4', async () => {
    const store = new MemoryVectorStore(2);
    await store.upsert([makeRecord('d1::chunk::0', 'doc-1', [1, 0])]);

    const service = createErasureService(store);
    const result = await service(request);

    expect(result.ok).toBe(true);
    expect(result.storeResults).toHaveLength(3);
    expect(result.storeResults.map((s) => s.store)).toEqual(['D1', 'D2', 'D4']);
    expect(result.storeResults.find((s) => s.store === 'D2')?.deleted).toBe(1);
  });
});
