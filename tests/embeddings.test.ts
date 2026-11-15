import { describe, expect, it } from 'vitest';
import {
  validateEmbeddingCompatibility,
  validateEmbeddingsForChunks,
  validateQueryEmbedding,
} from '../src/embeddings.js';
import type { Chunk, Embedding } from '../src/types.js';

const chunk: Chunk = {
  id: 'doc::chunk::0',
  documentId: 'doc',
  content: 'hello',
  index: 0,
  metadata: {
    documentId: 'doc',
    source: 'doc.txt',
    chunkId: 'doc::chunk::0',
    chunkIndex: 0,
  },
};

describe('embedding compatibility and validation', () => {
  it('detects document/query model and dimension mismatches explicitly', () => {
    const mismatch = validateEmbeddingCompatibility(
      { model: 'embed-a', dimensions: 3 },
      { model: 'embed-b', dimensions: 2 },
      'document',
    );

    expect(mismatch.ok).toBe(false);
    if (mismatch.ok) return;
    expect(mismatch.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'document.model' }),
        expect.objectContaining({ path: 'document.dimensions' }),
      ]),
    );
  });

  it('validates chunk embeddings against expected model/dimensions/count', () => {
    const embeddings: Embedding[] = [
      {
        chunkId: 'doc::chunk::0',
        model: 'embed-a',
        dimensions: 3,
        vector: [0.1, 0.2, 0.3],
      },
    ];

    expect(
      validateEmbeddingsForChunks([chunk], embeddings, { model: 'embed-a', dimensions: 3 }),
    ).toEqual({ ok: true, value: embeddings });

    const bad = validateEmbeddingsForChunks(
      [chunk],
      [{ chunkId: 'wrong', model: 'embed-b', dimensions: 2, vector: [1, Number.NaN] }],
      { model: 'embed-a', dimensions: 3 },
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.issues.some((i) => i.path.includes('chunkId'))).toBe(true);
    expect(bad.issues.some((i) => i.path.includes('model'))).toBe(true);
    expect(bad.issues.some((i) => i.path.includes('dimensions'))).toBe(true);
    expect(bad.issues.some((i) => i.path.includes('vector'))).toBe(true);
  });

  it('validates query embedding vector length and finite values', () => {
    const ok = validateQueryEmbedding(
      { chunkId: 'query', model: 'embed-a', dimensions: 2, vector: [1, 2] },
      { model: 'embed-a', dimensions: 2 },
    );
    expect(ok.ok).toBe(true);

    const bad = validateQueryEmbedding(
      { chunkId: 'query', model: 'embed-a', dimensions: 2, vector: [1, Infinity] },
      { model: 'embed-a', dimensions: 2 },
    );
    expect(bad.ok).toBe(false);
  });
});
