import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Document, DocumentMetadata, ValidationIssue } from './types.js';

export type ParseStatus = 'ok' | 'empty' | 'unsupported' | 'error';

export interface ParsedDocument {
  status: ParseStatus;
  source: string;
  document?: Document;
  issues: readonly ValidationIssue[];
}

/** Baseline text formats supported without additional parsing dependencies. */
const SUPPORTED_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.text']);

function toDocumentId(sourcePath: string): string {
  return path.resolve(sourcePath);
}

function buildMetadata(sourcePath: string): DocumentMetadata {
  const resolved = path.resolve(sourcePath);
  return {
    documentId: toDocumentId(resolved),
    source: resolved,
  };
}

function normalizeText(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

/**
 * Load and parse a single source file into a Document.
 * Reports unsupported, empty, missing, or unreadable inputs explicitly and does
 * not log document contents or secrets.
 */
export async function parseSourceFile(sourcePath: string): Promise<ParsedDocument> {
  const resolved = path.resolve(sourcePath);
  const ext = path.extname(resolved).toLowerCase();

  try {
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      return {
        status: 'error',
        source: resolved,
        issues: [{ path: resolved, message: 'source is not a regular file' }],
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unable to access source';
    return {
      status: 'error',
      source: resolved,
      issues: [{ path: resolved, message }],
    };
  }

  if (!SUPPORTED_TEXT_EXTENSIONS.has(ext)) {
    return {
      status: 'unsupported',
      source: resolved,
      issues: [
        {
          path: resolved,
          message: `unsupported file format "${ext || '(none)'}"; supported baseline formats: ${[...SUPPORTED_TEXT_EXTENSIONS].join(', ')}`,
        },
      ],
    };
  }

  try {
    const raw = await readFile(resolved, 'utf8');
    const content = normalizeText(raw);

    if (content.trim().length === 0) {
      return {
        status: 'empty',
        source: resolved,
        issues: [{ path: resolved, message: 'document is empty or contains only whitespace' }],
      };
    }

    const metadata = buildMetadata(resolved);
    const document: Document = {
      id: metadata.documentId,
      content,
      metadata,
    };

    return {
      status: 'ok',
      source: resolved,
      document,
      issues: [],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'failed to read or parse source';
    return {
      status: 'error',
      source: resolved,
      issues: [{ path: resolved, message }],
    };
  }
}
