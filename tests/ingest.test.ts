import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceFile } from '../src/ingest.js';

async function makeTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'rag-ingest-'));
}

describe('parseSourceFile', () => {
  it('parses a supported text file', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'note.txt');
    await writeFile(file, 'Hello RAG\nSecond line', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('ok');
    expect(result.issues).toEqual([]);
    expect(result.document?.content).toContain('Hello RAG');
    expect(result.document?.metadata.source).toBe(path.resolve(file));
    expect(result.document?.id).toBe(path.resolve(file));
  });

  it('reports empty documents explicitly', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'empty.md');
    await writeFile(file, '   \n\t', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('empty');
    expect(result.document).toBeUndefined();
    expect(result.issues[0]?.message).toMatch(/empty/i);
  });

  it('reports unsupported formats explicitly', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'scan.pdf');
    await writeFile(file, '%PDF-1.4', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('unsupported');
    expect(result.document).toBeUndefined();
    expect(result.issues[0]?.message).toMatch(/unsupported file format/i);
  });

  it('reports missing/unreadable sources explicitly', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'missing.txt');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('error');
    expect(result.document).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0]?.path).toBe(path.resolve(file));
  });

  it('reports non-file paths explicitly', async () => {
    const dir = await makeTempDir();
    const subdir = path.join(dir, 'folder');
    await mkdir(subdir);

    const result = await parseSourceFile(subdir);

    expect(result.status).toBe('error');
    expect(result.issues[0]?.message).toMatch(/not a regular file/i);
  });
});
