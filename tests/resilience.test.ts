import { describe, expect, it, vi } from 'vitest';
import { embedChunksWithValidation } from '../src/embeddings.js';
import { isRetryableProviderError, withRetry } from '../src/resilience.js';
import type { Chunk, Embedding } from '../src/types.js';

const chunk: Chunk = {
  id: 'd::chunk::0',
  documentId: 'd',
  content: 'hello',
  index: 0,
  metadata: { documentId: 'd', source: 'd.txt', chunkId: 'd::chunk::0', chunkIndex: 0 },
};

describe('resilience utilities', () => {
  it('classifies common transient/rate-limit provider errors as retryable', () => {
    expect(isRetryableProviderError({ status: 429 })).toBe(true);
    expect(isRetryableProviderError({ status: 503 })).toBe(true);
    expect(isRetryableProviderError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(isRetryableProviderError(new Error('Request timeout'))).toBe(true);
    expect(isRetryableProviderError({ status: 400 })).toBe(false);
    expect(isRetryableProviderError(new Error('invalid api key'))).toBe(false);
  });

  it('retries retryable failures and eventually succeeds', async () => {
    const op = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce({ status: 429, message: 'rate limit' })
      .mockResolvedValueOnce('ok');

    const result = await withRetry(op, { maxAttempts: 3, baseDelayMs: 0 });

    expect(result).toBe('ok');
    expect(op).toHaveBeenCalledTimes(2);
  });

  it('does not retry non-retryable failures', async () => {
    const op = vi.fn<() => Promise<string>>().mockRejectedValue({ status: 400, message: 'bad request' });

    await expect(withRetry(op, { maxAttempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({ status: 400 });
    expect(op).toHaveBeenCalledTimes(1);
  });

  it('surfaces exhausted retry failures', async () => {
    const op = vi.fn<() => Promise<string>>().mockRejectedValue({ status: 503, message: 'unavailable' });

    await expect(withRetry(op, { maxAttempts: 2, baseDelayMs: 0 })).rejects.toMatchObject({ status: 503 });
    expect(op).toHaveBeenCalledTimes(2);
  });
});

describe('embedChunksWithValidation', () => {
  it('returns provider failures as Result issues without partial success', async () => {
    const provider = {
      model: 'm',
      dimensions: 2,
      embedTexts: vi.fn(async () => {
        throw new Error('provider down');
      }),
    };

    const result = await embedChunksWithValidation(provider, [chunk], { model: 'm', dimensions: 2 }, { maxAttempts: 2, baseDelayMs: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.path).toBe('embeddingProvider');
  });

  it('retries transient provider failures then validates output', async () => {
    const embedding: Embedding = { chunkId: chunk.id, model: 'm', dimensions: 2, vector: [1, 0] };
    const provider = {
      model: 'm',
      dimensions: 2,
      embedTexts: vi
        .fn<() => Promise<readonly Embedding[]>>()
        .mockRejectedValueOnce({ status: 429 })
        .mockResolvedValueOnce([embedding]),
    };

    const result = await embedChunksWithValidation(provider, [chunk], { model: 'm', dimensions: 2 }, { maxAttempts: 3, baseDelayMs: 0 });
    expect(provider.embedTexts).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, value: [embedding] });
  });
});
