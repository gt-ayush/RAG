import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpLLMProvider } from '../src/llm-provider.js';
import type { GroundedPrompt, LLMProviderConfig } from '../src/types.js';
import type { LanguageModel } from '../src/generate.js';

const baseConfig: LLMProviderConfig = {
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-4o-mini',
  apiKey: 'test-llm-key',
  timeoutMs: 5000,
};

const basePrompt: GroundedPrompt = {
  system: 'You are a grounded assistant.',
  user: 'What is the policy?',
  evidence: '--- BEGIN Evidence 1 ---\nsourceId=d1 | chunkId=c1 | source=d1.txt\nSome policy text.\n--- END Evidence 1 ---',
};

function successfulChatResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const validCompletion = {
  id: 'chatcmpl-1',
  object: 'chat.completion',
  created: 1234567890,
  model: 'gpt-4o-mini',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'The policy allows remote work.' },
      finish_reason: 'stop',
    },
  ],
};

describe('HttpLLMProvider', () => {
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
      new HttpLLMProvider({ ...baseConfig, baseUrl: 'not-a-url' });
    }).toThrow('Invalid LLM provider baseUrl');
  });

  it('exposes model', () => {
    const provider = new HttpLLMProvider(baseConfig);
    expect(provider.model).toBe('gpt-4o-mini');
  });

  it('generates a grounded answer and maps system/user/evidence to messages', async () => {
    fetchMock.mockReturnValueOnce(successfulChatResponse(validCompletion));
    const provider = new HttpLLMProvider(baseConfig);

    const result = await provider.generate(basePrompt);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.stream).toBe(false);
    expect(Array.isArray(body.messages)).toBe(true);
    expect(body.messages[0]?.role).toBe('system');
    expect(body.messages[0]?.content).toBe(basePrompt.system);
    expect(body.messages[1]?.role).toBe('user');
    expect(body.messages[1]?.content).toContain(basePrompt.evidence);
    expect(body.messages[1]?.content).toContain(basePrompt.user);
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer test-llm-key');
    expect(result).toEqual({
      text: 'The policy allows remote work.',
      insufficientContext: false,
    });
  });

  it('returns empty text and insufficientContext when content is empty', async () => {
    fetchMock.mockReturnValueOnce(
      successfulChatResponse({ ...validCompletion, choices: [{ ...validCompletion.choices[0], message: { role: 'assistant', content: '' } }] }),
    );
    const provider = new HttpLLMProvider(baseConfig);

    const result = await provider.generate(basePrompt);

    expect(result).toEqual({ text: '', insufficientContext: true });
  });

  it('returns empty array for empty evidence/query without calling provider is not applicable; still calls provider', async () => {
    // generate always calls the provider; emptiness is handled by generateGroundedAnswer.
    fetchMock.mockReturnValueOnce(successfulChatResponse(validCompletion));
    const provider = new HttpLLMProvider(baseConfig);

    await provider.generate({ system: 'sys', user: '', evidence: '' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on provider model mismatch without echoing the API key', async () => {
    fetchMock.mockReturnValueOnce(
      successfulChatResponse({ ...validCompletion, model: 'different-model' }),
    );
    const provider = new HttpLLMProvider(baseConfig);

    await expect(provider.generate(basePrompt)).rejects.toThrow('LLM model mismatch');
    const body = JSON.stringify(fetchMock.mock.calls[0]?.[1]?.body);
    expect(body).not.toContain('test-llm-key');
  });

  it('throws when response is not ok', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({ error: { message: 'invalid api key' } }),
    } as Response);
    const provider = new HttpLLMProvider(baseConfig);

    await expect(provider.generate(basePrompt)).rejects.toThrow('provider returned 401');
  });

  it('throws on malformed response (missing choices)', async () => {
    fetchMock.mockReturnValueOnce(successfulChatResponse({ id: 'x', object: 'chat.completion', created: 1, model: 'gpt-4o-mini' }));
    const provider = new HttpLLMProvider(baseConfig);

    await expect(provider.generate(basePrompt)).rejects.toThrow('must be a non-empty array');
  });

  it('propagates abort/timeout errors', async () => {
    const abortError = new Error('The operation timed out.');
    (abortError as { name?: string }).name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abortError);
    const provider = new HttpLLMProvider({ ...baseConfig, timeoutMs: 1 });

    await expect(provider.generate(basePrompt)).rejects.toThrow('timed out');
  });

  it('does not send Authorization header when no apiKey is configured', async () => {
    fetchMock.mockReturnValueOnce(successfulChatResponse(validCompletion));
    const provider = new HttpLLMProvider({ ...baseConfig, apiKey: undefined });

    await provider.generate(basePrompt);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('implements the LanguageModel contract', () => {
    const provider = new HttpLLMProvider(baseConfig);
    expect(typeof (provider as LanguageModel).generate).toBe('function');
    expect((provider as LanguageModel).model).toBe('gpt-4o-mini');
  });
});
