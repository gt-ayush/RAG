import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  Chunk,
  ChunkMetadata,
  Document,
  DocumentMetadata,
  Result,
  ValidationIssue,
} from './types.js';

export type ParseStatus = 'ok' | 'empty' | 'unsupported' | 'error';

export interface ParsedDocument {
  status: ParseStatus;
  source: string;
  document?: Document;
  issues: readonly ValidationIssue[];
}

/** Supported file extensions for parsing. */
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.text',  // plain text
  '.html', '.htm',                      // HTML
  '.json',                              // JSON
  '.csv',                               // CSV
  '.pdf',                               // PDF
]);

function toDocumentId(sourcePath: string): string {
  return path.resolve(sourcePath);
}

function computeContentHash(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function buildMetadata(sourcePath: string, content?: string): DocumentMetadata {
  const resolved = path.resolve(sourcePath);
  return {
    documentId: toDocumentId(resolved),
    source: resolved,
    ...(content !== undefined ? { contentHash: computeContentHash(content) } : {}),
  };
}

function normalizeText(content: string): string {
  return content.replace(/^\uFEFF/, '');
}

/**
 * Parse HTML content into plain text by stripping tags and decoding entities.
 */
function parseHtml(content: string): string {
  let text = content
    // Remove script and style elements
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    // Remove HTML tags
    .replace(/<[^>]*>/g, ' ')
    // Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_: string, code: string) => String.fromCharCode(parseInt(code, 16)))
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
  return text;
}

/**
 * Parse JSON content by extracting all string values recursively.
 */
function parseJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return extractStringsFromJson(parsed);
  } catch {
    throw new Error('invalid JSON');
  }
}

function extractStringsFromJson(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => extractStringsFromJson(v)).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value).map((v) => extractStringsFromJson(v)).filter(Boolean).join(' ');
  }
  return '';
}

/**
 * Parse CSV content into plain text by joining all field values.
 */
function parseCsv(content: string): string {
  const lines = content.split('\n');
  const rows = lines.map((line) => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields.join(' ');
  });
  return rows.filter((r) => r.trim().length > 0).join(' ');
}

/**
 * Parse PDF content by extracting text from uncompressed PDF content streams.
 * Note: This handles basic PDF text extraction; complex PDFs with compressed
 * streams or complex encodings may not extract text correctly.
 */
function parsePdf(content: Buffer): string {
  const text = content.toString('latin1');
  const textParts: string[] = [];
  // Find text between stream and endstream markers
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRegex.exec(text)) !== null) {
    const streamContent = match[1] ?? '';
    // Extract text strings from PDF content stream (parenthesized strings)
    const textMatches = streamContent.match(/\(([^)]*)\)/g) || [];
    for (const match of textMatches) {
      const text = match.slice(1, -1);
      if (text.length > 0) {
        textParts.push(text);
      }
    }
  }
  return textParts.join(' ');
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
    // PDF requires binary reading; other formats are read as text
    if (ext === '.pdf') {
      const raw = await readFile(resolved);
      const content = parsePdf(raw);
      if (content.trim().length === 0) {
        return {
          status: 'empty',
          source: resolved,
          issues: [{ path: resolved, message: 'document is empty or contains only whitespace' }],
        };
      }
      const metadata = buildMetadata(resolved, content);
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
    }

    // Text-based formats
    const raw = await readFile(resolved, 'utf8');
    let content: string;

    switch (ext) {
      case '.html':
      case '.htm':
        content = parseHtml(raw);
        break;
      case '.json':
        content = parseJson(raw);
        break;
      case '.csv':
        content = parseCsv(raw);
        break;
      default:
        content = normalizeText(raw);
    }

    if (content.trim().length === 0) {
      return {
        status: 'empty',
        source: resolved,
        issues: [{ path: resolved, message: 'document is empty or contains only whitespace' }],
      };
    }

    const metadata = buildMetadata(resolved, content);
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

export interface ChunkingOptions {
  /** Maximum chunk size in characters (baseline deterministic strategy). */
  chunkSize: number;
  /** Overlap between consecutive chunks in characters. */
  chunkOverlap: number;
}

const DEFAULT_CHUNKING_OPTIONS: ChunkingOptions = {
  chunkSize: 512,
  chunkOverlap: 50,
};

export function validateChunkingOptions(
  options: Partial<ChunkingOptions> = {},
): Result<ChunkingOptions> {
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNKING_OPTIONS.chunkSize;
  const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNKING_OPTIONS.chunkOverlap;
  const issues: ValidationIssue[] = [];

  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    issues.push({ path: 'chunkSize', message: 'must be a positive integer' });
  }
  if (!Number.isInteger(chunkOverlap) || chunkOverlap < 0) {
    issues.push({ path: 'chunkOverlap', message: 'must be a non-negative integer' });
  }
  if (
    Number.isInteger(chunkSize) &&
    Number.isInteger(chunkOverlap) &&
    chunkSize > 0 &&
    chunkOverlap >= 0 &&
    chunkOverlap >= chunkSize
  ) {
    issues.push({ path: 'chunkOverlap', message: 'must be less than chunkSize' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { chunkSize, chunkOverlap } };
}

function buildChunkId(documentId: string, index: number): string {
  return `${documentId}::chunk::${index}`;
}

/**
 * Deterministically split a document into overlapping character chunks while
 * preserving source traceability metadata and offsets.
 */
export function chunkDocument(
  document: Document,
  options: Partial<ChunkingOptions> = {},
): Result<readonly Chunk[]> {
  const validated = validateChunkingOptions(options);
  if (!validated.ok) {
    return validated;
  }

  const { chunkSize, chunkOverlap } = validated.value;
  const content = document.content;
  if (content.length === 0) {
    return { ok: true, value: [] };
  }

  const chunks: Chunk[] = [];
  const step = chunkSize - chunkOverlap;
  let start = 0;
  let index = 0;

  while (start < content.length) {
    const end = Math.min(start + chunkSize, content.length);
    const chunkContent = content.slice(start, end);
    const chunkId = buildChunkId(document.id, index);
    const metadata: ChunkMetadata = {
      ...document.metadata,
      documentId: document.id,
      source: document.metadata.source,
      chunkId,
      chunkIndex: index,
      startOffset: start,
      endOffset: end,
    };

    chunks.push({
      id: chunkId,
      documentId: document.id,
      content: chunkContent,
      index,
      metadata,
    });

    if (end >= content.length) {
      break;
    }

    start += step;
    index += 1;
  }

  return { ok: true, value: chunks };
}

export interface IngestFileResult {
  source: string;
  parse: ParsedDocument;
  chunks?: readonly Chunk[];
  chunkIssues?: readonly ValidationIssue[];
}

export interface IngestBatch {
  files: readonly IngestFileResult[];
  /** Deterministic, deduplicated chunks by chunk id across the batch. */
  chunks: readonly Chunk[];
  duplicatesSkipped: number;
}

/**
 * Parse and chunk multiple sources. Per-file failures/unsupported/empty inputs
 * are reported explicitly without aborting the rest of the batch.
 * Repeated runs over the same unchanged inputs produce identical chunk records.
 */
export async function ingestSources(
  sourcePaths: readonly string[],
  options: Partial<ChunkingOptions> = {},
): Promise<IngestBatch> {
  const files: IngestFileResult[] = [];
  const byChunkId = new Map<string, Chunk>();
  let duplicatesSkipped = 0;

  for (const sourcePath of sourcePaths) {
    const parse = await parseSourceFile(sourcePath);
    if (parse.status !== 'ok' || !parse.document) {
      files.push({ source: parse.source, parse });
      continue;
    }

    const chunked = chunkDocument(parse.document, options);
    if (!chunked.ok) {
      files.push({
        source: parse.source,
        parse,
        chunkIssues: chunked.issues,
      });
      continue;
    }

    files.push({
      source: parse.source,
      parse,
      chunks: chunked.value,
      chunkIssues: [],
    });

    for (const chunk of chunked.value) {
      if (byChunkId.has(chunk.id)) {
        duplicatesSkipped += 1;
        continue;
      }
      byChunkId.set(chunk.id, chunk);
    }
  }

  return {
    files,
    chunks: [...byChunkId.values()],
    duplicatesSkipped,
  };
}


