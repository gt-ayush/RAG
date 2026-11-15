import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpEmbeddingProvider } from '../src/embedding-provider.js';
import type { EmbeddingProviderConfig } from '../src/types.js';

const baseConfig: EmbeddingProviderConfig = {
  baseUrl: 'https://api.example.com/v1',
  model: 'text-embedding-3-small',
  dimensions: 3,
  apiKey: 'test-key',
  timeoutMs: 5000,
};

function successfulFetch(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const validEmbeddings = {
  object: 'list',
  data: [
    { object: 'embedding', index: 0, embedding: [0.1, 0.2, 0.3] },
    { object: 'embedding', index: 1, embedding: [0.4, 0.5, 0.6] },
  ],
  model: 'text-embedding-3-small',
  usage: { prompt_tokens: 10, total_tokens: 10 },
};

describe('HttpEmbeddingProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('throws when baseUrl is invalid', () => {
    expect(() => {
      new HttpEmbeddingProvider({
        ...baseConfig,
        baseUrl: 'not-a-url',
      });
    }).toThrow('Invalid embedding provider baseUrl');
  });

  it('exposes model and dimensions', () => {
    const provider = new HttpEmbeddingProvider(baseConfig);
    expect(provider.model).toBe('text-embedding-3-small');
    expect(provider.dimensions).toBe(3);
  });

  it('embeds texts and maps chunk ids by purpose order', async () => {
    fetchMock.mockReturnValueOnce(successfulFetch(validEmbeddings));
    const provider = new HttpEmbeddingProvider(baseConfig);

    const result = await provider.embedTexts(['hello world', 'goodbye'], 'document');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: 'text-embedding-3-small',
      input: ['hello world', 'goodbye'],
      encoding_format: 'float',
      dimensions: 3,
    });
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect(result).toEqual([
      { chunkId: 'document:0', model: 'text-embedding-3-small', dimensions: 3, vector: [0.1, 0.2, 0.3] },
      { chunkId: 'document:1', model: 'text-embedding-3-small', dimensions: 3, vector: [0.4, 0.5, 0.6] },
    ]);
  });

  it('embeds chunks and preserves chunk ids', async () => {
    fetchMock.mockReturnValueOnce(successfulFetch(validEmbeddings));
    const provider = new HttpEmbeddingProvider(baseConfig);

    const chunks = [
      { id: 'c1', documentId: 'd', content: 'a', index: 0, metadata: { documentId: 'd', source: 'x', chunkId: 'c1', chunkIndex: 0 } },
      { id: 'c2', documentId: 'd', content: 'b', index: 1, metadata: { documentId: 'd', source: 'x', chunkId: 'c2', chunkIndex: 1 } },
    ];

    const result = await provider.embedChunks(chunks, 'document');

    expect(result).toEqual([
      { chunkId: 'c1', model: 'text-embedding-3-small', dimensions: 3, vector: [0.1, 0.2, 0.3] },
      { chunkId: 'c2', model: 'text-embedding-3-small', dimensions: 3, vector: [0.4, 0.5, 0.6] },
    ]);
  });

  it('returns empty array for empty input without calling the provider', async () => {
    const provider = new HttpEmbeddingProvider(baseConfig);

    expect(await provider.embedTexts([], 'query')).toEqual([]);
    expect(await provider.embedChunks([], 'document')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('throws on provider model mismatch without echoing the API key', async () => {
    fetchMock.mockReturnValueOnce(
      successfulFetch({ ...validEmbeddings, model: 'different-model' }),
    );
    const provider = new HttpEmbeddingProvider(baseConfig);

    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow('embedding model mismatch');
    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow();
    const body = JSON.stringify(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain('test-key');
  });

  it('throws on dimensions mismatch', async () => {
    fetchMock.mockReturnValueOnce(
      successfulFetch({ ...validEmbeddings, data: [{ ...validEmbeddings.data[0], embedding: [0.1, 0.2] }] }),
    );
    const provider = new HttpEmbeddingProvider(baseConfig);

    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow('dimensions mismatch');
  });

  it('throws on non-finite values', async () => {
    fetchMock.mockReturnValueOnce(
      successfulFetch({ ...validEmbeddings, data: [{ ...validEmbeddings.data[0], embedding: [0.1, Infinity, 0.3] }] }),
    );
    const provider = new HttpEmbeddingProvider(baseConfig);

    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow('must contain only finite numbers');
  });

  it('throws when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: { message: 'invalid api key' } }),
    } as Response);
    const provider = new HttpEmbeddingProvider(baseConfig);

    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow('provider returned 401');
  });

  it('propagates abort/timeout errors', async () => {
    const abortError = new Error('The operation timed out.');
    (abortError as { name?: string }).name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);
    const provider = new HttpEmbeddingProvider({ ...baseConfig, timeoutMs: 1 });

    await expect(provider.embedTexts(['hello'], 'query')).rejects.toThrow('timed out');
  });

  it('does not send Authorization header when no apiKey is configured', async () => {
    fetchMock.mockReturnValueOnce(successfulFetch(validEmbeddings));
    const provider = new HttpEmbeddingProvider({ ...baseConfig, apiKey: undefined });

    await provider.embedTexts(['hello'], 'query');
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });
});
