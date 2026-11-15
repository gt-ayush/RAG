import type { Chunk, Embedding, Result, ValidationIssue } from './types.js';
import { isRetryableProviderError, withRetry } from './resilience.js';

export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embedTexts(texts: readonly string[], purpose: 'document' | 'query'): Promise<readonly Embedding[]>;
}

export interface EmbeddingCompatibility {
  model: string;
  dimensions: number;
}

function issue(path: string, message: string): ValidationIssue {
  return { path, message };
}

export function validateEmbeddingCompatibility(
  expected: EmbeddingCompatibility,
  actual: { model: string; dimensions: number },
  context: 'document' | 'query',
): Result<EmbeddingCompatibility> {
  const issues: ValidationIssue[] = [];

  if (actual.model !== expected.model) {
    issues.push(
      issue(
        `${context}.model`,
        `embedding model mismatch: expected "${expected.model}" but received "${actual.model}"`,
      ),
    );
  }
  if (actual.dimensions !== expected.dimensions) {
    issues.push(
      issue(
        `${context}.dimensions`,
        `embedding dimensions mismatch: expected ${expected.dimensions} but received ${actual.dimensions}`,
      ),
    );
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: actual };
}

export function validateEmbeddingsForChunks(
  chunks: readonly Chunk[],
  embeddings: readonly Embedding[],
  expected: EmbeddingCompatibility,
): Result<readonly Embedding[]> {
  const issues: ValidationIssue[] = [];

  if (chunks.length !== embeddings.length) {
    issues.push(
      issue(
        'embeddings',
        `embedding count mismatch: expected ${chunks.length} but received ${embeddings.length}`,
      ),
    );
  }

  for (let i = 0; i < embeddings.length; i += 1) {
    const embedding = embeddings[i];
    const chunk = chunks[i];
    const path = `embeddings[${i}]`;
    if (!embedding) continue;

    if (chunk && embedding.chunkId !== chunk.id) {
      issues.push(
        issue(`${path}.chunkId`, `chunk id mismatch: expected "${chunk.id}" but received "${embedding.chunkId}"`),
      );
    }
    if (embedding.model !== expected.model) {
      issues.push(
        issue(`${path}.model`, `embedding model mismatch: expected "${expected.model}" but received "${embedding.model}"`),
      );
    }
    if (embedding.dimensions !== expected.dimensions) {
      issues.push(
        issue(
          `${path}.dimensions`,
          `declared dimensions mismatch: expected ${expected.dimensions} but received ${embedding.dimensions}`,
        ),
      );
    }
    if (embedding.vector.length !== expected.dimensions) {
      issues.push(
        issue(
          `${path}.vector`,
          `vector length mismatch: expected ${expected.dimensions} but received ${embedding.vector.length}`,
        ),
      );
    }
    if (embedding.vector.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      issues.push(issue(`${path}.vector`, 'vector must contain only finite numbers'));
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: embeddings };
}

export function validateQueryEmbedding(
  embedding: Embedding,
  expected: EmbeddingCompatibility,
): Result<Embedding> {
  const compat = validateEmbeddingCompatibility(expected, embedding, 'query');
  const issues: ValidationIssue[] = compat.ok ? [] : [...compat.issues];

  if (embedding.vector.length !== expected.dimensions) {
    issues.push(
      issue(
        'query.vector',
        `vector length mismatch: expected ${expected.dimensions} but received ${embedding.vector.length}`,
      ),
    );
  }
  if (embedding.vector.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    issues.push(issue('query.vector', 'vector must contain only finite numbers'));
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: embedding };
}

export interface EmbedChunksOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
}

/**
 * Embed document chunks via provider with optional bounded retries for transient
 * provider failures/rate limits, then validate model/dimension/count integrity.
 * Provider errors are returned as Result issues (no partial success state).
 */
export async function embedChunksWithValidation(
  provider: EmbeddingProvider,
  chunks: readonly Chunk[],
  expected: EmbeddingCompatibility,
  options: EmbedChunksOptions = {},
): Promise<Result<readonly Embedding[]>> {
  try {
    const embeddings = await withRetry(
      () => provider.embedTexts(chunks.map((c) => c.content), 'document'),
      {
        maxAttempts: options.maxAttempts ?? 1,
        baseDelayMs: options.baseDelayMs ?? 0,
        retryable: isRetryableProviderError,
      },
    );
    return validateEmbeddingsForChunks(chunks, embeddings, expected);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'embedding provider failed';
    return { ok: false, issues: [{ path: 'embeddingProvider', message }] };
  }
}

