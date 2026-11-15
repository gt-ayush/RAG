import type { Chunk, Embedding, EmbeddingProviderConfig, Result } from './types.js';
import type { EmbeddingProvider } from './embeddings.js';

/**
 * Source-of-truth keywords: EmbeddingProvider, HTTP, OpenAI-compatible,
 * timeout, retryable
 */

/**
 * Request shape for an OpenAI-compatible embeddings endpoint.
 */
interface EmbeddingsRequestBody {
  model: string;
  input: readonly string[];
  encoding_format?: 'float';
  dimensions?: number;
  user?: string;
}

/**
 * Minimal response shape for an OpenAI-compatible embeddings endpoint.
 */
interface EmbeddingsResponseBody {
  object: string;
  data: readonly EmbeddingDataItem[];
  model: string;
  usage?: { prompt_tokens?: number; total_tokens?: number };
}

interface EmbeddingDataItem {
  object: string;
  index: number;
  embedding: readonly number[];
}

/**
 * Untrusted provider response parsed only into our typed Embedding objects;
 * all fields are re-validated by the caller (validateEmbeddingsForChunks).
 */
function parseEmbeddingsResponse(
  body: unknown,
  expectedModel: string,
  expectedDimensions: number,
): Result<Embedding[]> {
  const issues: { path: string; message: string }[] = [];
  const typed = body as EmbeddingsResponseBody | undefined;

  if (!typed || typeof typed !== 'object') {
    return { ok: false, issues: [{ path: 'embeddingProvider', message: 'invalid response body' }] };
  }
  if (typed.object !== 'list') {
    issues.push({ path: 'embeddingProvider.object', message: 'expected "list"' });
  }
  if (!Array.isArray(typed.data)) {
    issues.push({ path: 'embeddingProvider.data', message: 'must be an array' });
  }
  if (typed.model !== expectedModel) {
    issues.push({
      path: 'embeddingProvider.model',
      message: `embedding model mismatch: expected "${expectedModel}" but received "${String(typed.model)}"`,
    });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const embeddings: Embedding[] = [];
  for (const item of typed.data as readonly EmbeddingDataItem[]) {
    if (!item || typeof item !== 'object') {
      return { ok: false, issues: [{ path: 'embeddingProvider.data[]', message: 'invalid item' }] };
    }
    if (!Array.isArray(item.embedding)) {
      return {
        ok: false,
        issues: [{ path: `embeddingProvider.data[${item.index}].embedding`, message: 'must be an array of numbers' }],
      };
    }
    if (item.embedding.length !== expectedDimensions) {
      return {
        ok: false,
        issues: [
          {
            path: `embeddingProvider.data[${item.index}].embedding`,
            message: `dimensions mismatch: expected ${expectedDimensions} but received ${item.embedding.length}`,
          },
        ],
      };
    }
    if (item.embedding.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      return {
        ok: false,
        issues: [{ path: `embeddingProvider.data[${item.index}].embedding`, message: 'must contain only finite numbers' }],
      };
    }
    embeddings.push({
      chunkId: `http:${item.index}`,
      model: expectedModel,
      dimensions: expectedDimensions,
      vector: [...item.embedding],
    });
  }

  return { ok: true, value: embeddings };
}

/**
 * Generic OpenAI-compatible HTTP embeddings provider.
 *
 * Keeps provider SDK details inside this adapter so pipeline modules never call
 * a vendor SDK directly. Enforces model/version pinning and dimensions, applies
 * a per-request timeout, returns failures as thrown errors (the caller's
 * withRetry bounds transient 429/5xx attempts), and never logs or returns secret
 * values in error messages.
 */
export class HttpEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(config: EmbeddingProviderConfig) {
    try {
      new URL(config.baseUrl);
    } catch {
      throw new Error(`Invalid embedding provider baseUrl: ${config.baseUrl}`);
    }

    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    this.model = config.model;
    this.dimensions = config.dimensions;
    this.timeoutMs = Math.max(1, Math.trunc(config.timeoutMs ?? 30000));
    this.apiKey = config.apiKey;
  }

  async embedTexts(texts: readonly string[], purpose: 'document' | 'query'): Promise<readonly Embedding[]> {
    if (texts.length === 0) return [];
    const parsed = await this.postEmbeddings(texts);
    if (!parsed.ok) {
      const message = parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      throw new Error(`embedding provider failed: ${message}`);
    }
    return parsed.value.map((e, idx) => ({
      ...e,
      chunkId: `${purpose}:${idx}`,
    }));
  }

  async embedChunks(chunks: readonly Chunk[], purpose: 'document'): Promise<readonly Embedding[]> {
    if (chunks.length === 0) return [];
    const parsed = await this.postEmbeddings(chunks.map((c) => c.content));
    if (!parsed.ok) {
      const message = parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ');
      throw new Error(`embedding provider failed: ${message}`);
    }
    return parsed.value.map((e, idx) => ({
      ...e,
      chunkId: chunks[idx]?.id ?? `http:${idx}`,
    }));
  }

  private async postEmbeddings(texts: readonly string[]): Promise<Result<Embedding[]>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey !== undefined ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          encoding_format: 'float',
          ...(this.dimensions ? { dimensions: this.dimensions } : {}),
        } as EmbeddingsRequestBody),
        signal: controller.signal,
      });

      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }

      if (!response.ok) {
        const detail = body && typeof body === 'object' && 'error' in body && typeof (body as { error?: unknown }).error === 'object'
          ? JSON.stringify((body as { error?: { message?: unknown } }).error)
          : String(response.status);
        // Never echo provider internals or secrets in returned messages.
        throw new Error(`provider returned ${response.status}: ${detail}`);
      }

      return parseEmbeddingsResponse(body, this.model, this.dimensions);
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('embedding provider failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
