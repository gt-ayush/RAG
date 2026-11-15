import { describe, expect, it } from 'vitest';
import { chunkDocument, validateChunkingOptions } from '../src/ingest.js';
import type { Document } from '../src/types.js';

const document: Document = {
  id: '/tmp/doc.txt',
  content: 'abcdefghij',
  metadata: {
    documentId: '/tmp/doc.txt',
    source: '/tmp/doc.txt',
    section: 'intro',
  },
};

describe('validateChunkingOptions', () => {
  it('accepts valid options and applies defaults', () => {
    expect(validateChunkingOptions()).toEqual({
      ok: true,
      value: { chunkSize: 512, chunkOverlap: 50 },
    });
    expect(validateChunkingOptions({ chunkSize: 10, chunkOverlap: 2 })).toEqual({
      ok: true,
      value: { chunkSize: 10, chunkOverlap: 2 },
    });
  });

  it('rejects invalid size/overlap settings', () => {
    expect(validateChunkingOptions({ chunkSize: 0, chunkOverlap: 0 }).ok).toBe(false);
    expect(validateChunkingOptions({ chunkSize: -1, chunkOverlap: 0 }).ok).toBe(false);
    expect(validateChunkingOptions({ chunkSize: 10, chunkOverlap: -1 }).ok).toBe(false);
    expect(validateChunkingOptions({ chunkSize: 10, chunkOverlap: 10 }).ok).toBe(false);
    expect(validateChunkingOptions({ chunkSize: 10.5, chunkOverlap: 0 }).ok).toBe(false);
  });
});

describe('chunkDocument', () => {
  it('creates deterministic, traceable chunks with offsets and preserved metadata', () => {
    const first = chunkDocument(document, { chunkSize: 4, chunkOverlap: 1 });
    const second = chunkDocument(document, { chunkSize: 4, chunkOverlap: 1 });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.value).toEqual(second.value);
    expect(first.value.map((c) => c.content)).toEqual(['abcd', 'defg', 'ghij']);
    expect(first.value.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(first.value.map((c) => [c.metadata.startOffset, c.metadata.endOffset])).toEqual([
      [0, 4],
      [3, 7],
      [6, 10],
    ]);
    for (const chunk of first.value) {
      expect(chunk.documentId).toBe(document.id);
      expect(chunk.metadata.documentId).toBe(document.id);
      expect(chunk.metadata.source).toBe(document.metadata.source);
      expect(chunk.metadata.section).toBe('intro');
      expect(chunk.id).toBe(`${document.id}::chunk::${chunk.index}`);
      expect(chunk.metadata.chunkId).toBe(chunk.id);
      expect(chunk.metadata.chunkIndex).toBe(chunk.index);
    }
  });

  it('returns a single chunk when content fits within chunk size', () => {
    const result = chunkDocument(document, { chunkSize: 20, chunkOverlap: 5 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.content).toBe('abcdefghij');
    expect(result.value[0]?.metadata.startOffset).toBe(0);
    expect(result.value[0]?.metadata.endOffset).toBe(10);
  });

  it('returns validation issues for invalid options', () => {
    const result = chunkDocument(document, { chunkSize: 5, chunkOverlap: 5 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: 'chunkOverlap',
      message: 'must be less than chunkSize',
    });
  });

  it('returns no chunks for empty content', () => {
    const emptyDoc: Document = { ...document, content: '' };
    const result = chunkDocument(emptyDoc, { chunkSize: 4, chunkOverlap: 1 });
    expect(result).toEqual({ ok: true, value: [] });
  });
});
