import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ingestSources, parseSourceFile } from '../src/ingest.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'rag-batch-'));
}

describe('ingestSources', () => {
  it('is repeatable and produces identical chunk records for unchanged inputs', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'doc.txt');
    await writeFile(file, 'repeatable content for chunking', 'utf8');

    const a = await ingestSources([file], { chunkSize: 10, chunkOverlap: 2 });
    const b = await ingestSources([file], { chunkSize: 10, chunkOverlap: 2 });

    expect(a.duplicatesSkipped).toBe(0);
    expect(b.duplicatesSkipped).toBe(0);
    expect(a.chunks).toEqual(b.chunks);
    expect(a.files[0]?.parse.document?.metadata.contentHash).toBe(
      b.files[0]?.parse.document?.metadata.contentHash,
    );
  });

  it('deduplicates repeated sources by stable chunk id within a batch', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'doc.txt');
    await writeFile(file, 'same file ingested twice', 'utf8');

    const batch = await ingestSources([file, file], { chunkSize: 8, chunkOverlap: 2 });

    expect(batch.files).toHaveLength(2);
    expect(batch.files.every((f) => f.parse.status === 'ok')).toBe(true);
    expect(batch.duplicatesSkipped).toBe(batch.files[0]?.chunks?.length ?? 0);
    expect(batch.chunks.map((c) => c.id)).toEqual(
      (batch.files[0]?.chunks ?? []).map((c) => c.id),
    );
  });

  it('reports per-file failures/unsupported/empty inputs without aborting others', async () => {
    const dir = await makeTempDir();
    const ok = path.join(dir, 'ok.txt');
    const empty = path.join(dir, 'empty.txt');
    const bad = path.join(dir, 'bad.pdf');
    const missing = path.join(dir, 'missing.txt');
    await writeFile(ok, 'valid content', 'utf8');
    await writeFile(empty, '   ', 'utf8');
    await writeFile(bad, '%PDF', 'utf8');

    const batch = await ingestSources([ok, empty, bad, missing], {
      chunkSize: 20,
      chunkOverlap: 0,
    });

    expect(batch.files.map((f) => f.parse.status)).toEqual([
      'ok',
      'empty',
      'empty',
      'error',
    ]);
    expect(batch.chunks).toHaveLength(1);
    expect(batch.chunks[0]?.documentId).toBe(path.resolve(ok));
  });

  it('includes content hash metadata for successful parses', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'doc.md');
    await writeFile(file, '# Title', 'utf8');

    const parsed = await parseSourceFile(file);

    expect(parsed.status).toBe('ok');
    expect(parsed.document?.metadata.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
