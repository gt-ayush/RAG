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
    const file = path.join(dir, 'scan.xyz');
    await writeFile(file, 'binary garbage content', 'utf8');

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

  it('parses HTML files and extracts text content', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'page.html');
    await writeFile(
      file,
      '<html><head><title>Test Page</title></head><body><h1>Hello World</h1><p>This is a <b>test</b> paragraph.</p></body></html>',
      'utf8'
    );

    const result = await parseSourceFile(file);

    expect(result.status).toBe('ok');
    expect(result.document?.content).toContain('Hello World');
    expect(result.document?.content).toContain('This is a test paragraph');
    expect(result.document?.content).not.toContain('<html>');
    expect(result.document?.content).not.toContain('<p>');
  });

  it('parses JSON files and extracts string values', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'data.json');
    await writeFile(
      file,
      JSON.stringify({ name: 'John Doe', role: 'Engineer', skills: ['Rust', 'TypeScript'] }),
      'utf8'
    );

    const result = await parseSourceFile(file);

    expect(result.status).toBe('ok');
    expect(result.document?.content).toContain('John Doe');
    expect(result.document?.content).toContain('Engineer');
    expect(result.document?.content).toContain('Rust');
    expect(result.document?.content).toContain('TypeScript');
  });

  it('parses JSON files with invalid JSON as error', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'bad.json');
    await writeFile(file, '{invalid json', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('error');
    expect(result.document).toBeUndefined();
    expect(result.issues[0]?.message).toMatch(/invalid JSON/i);
  });

  it('parses CSV files and extracts field values', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'data.csv');
    await writeFile(file, 'name,role,skill\nJohn Doe,Engineer,Rust\nJane Smith,Designer,TypeScript', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('ok');
    expect(result.document?.content).toContain('John Doe');
    expect(result.document?.content).toContain('Engineer');
    expect(result.document?.content).toContain('Rust');
    expect(result.document?.content).toContain('Jane Smith');
    expect(result.document?.content).toContain('Designer');
    expect(result.document?.content).toContain('TypeScript');
  });

  it('parses PDF files and extracts text content', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'document.pdf');
    // Minimal PDF with a text stream containing "Hello PDF World"
    const pdfContent = Buffer.from(
      '%PDF-1.4\nstream\n(Hello PDF World)\nendstream\n%%EOF',
      'latin1'
    );
    await writeFile(file, pdfContent);

    const result = await parseSourceFile(file);

    expect(result.status).toBe('ok');
    expect(result.document?.content).toContain('Hello PDF World');
  });

  it('parses PDF files with no text content as empty', async () => {
    const dir = await makeTempDir();
    const file = path.join(dir, 'empty.pdf');
    await writeFile(file, '%PDF-1.4', 'utf8');

    const result = await parseSourceFile(file);

    expect(result.status).toBe('empty');
    expect(result.document).toBeUndefined();
    expect(result.issues[0]?.message).toMatch(/empty/i);
  });
});
