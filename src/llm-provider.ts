import type { GroundedPrompt, LanguageModel, ModelGeneration } from './generate.js';
import type { LLMProviderConfig } from './types.js';

/**
 * Source-of-truth keywords: LLMProvider, LLM, chat completions, HTTP,
 * timeout, retryable
 */

/** Minimal OpenAI-compatible chat completions request body. */
interface ChatCompletionsRequest {
  model: string;
  messages: readonly ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** Minimal OpenAI-compatible chat message. */
interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Minimal OpenAI-compatible chat completions response body. */
interface ChatCompletionsResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: readonly ChatChoice[];
}

interface ChatChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
}

/**
 * Generic OpenAI-compatible HTTP LLM provider implementing the existing
 * `LanguageModel` contract.
 *
 * Keeps provider SDK details inside this adapter so pipeline modules never call
 * a vendor SDK directly. Enforces model pinning, applies a per-request timeout,
 * surfaces failures as thrown errors (the caller's generateGroundedAnswer
 * converts them to Result issues), and never logs or returns secret values in
 * error messages.
 */
export class HttpLLMProvider implements LanguageModel {
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly apiKey: string | undefined;

  constructor(config: LLMProviderConfig) {
    try {
      new URL(config.baseUrl);
    } catch {
      throw new Error(`Invalid LLM provider baseUrl: ${config.baseUrl}`);
    }

    this.baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl.slice(0, -1) : config.baseUrl;
    this.model = config.model;
    this.timeoutMs = Math.max(1, Math.trunc(config.timeoutMs ?? 30000));
    this.apiKey = config.apiKey;
  }

  async generate(prompt: GroundedPrompt): Promise<ModelGeneration> {
    const messages: ChatMessage[] = [
      { role: 'system', content: prompt.system },
      { role: 'user', content: `${prompt.evidence}\n\n---\n\nQuestion: ${prompt.user}` },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey !== undefined ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0,
          stream: false,
        } as ChatCompletionsRequest),
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
        throw new Error(`provider returned ${response.status}: ${detail}`);
      }

      const parsed = parseChatResponse(body, this.model);
      if (!parsed.ok) {
        throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
      }

      return parsed.value;
    } catch (error) {
      if (error instanceof Error) throw error;
      throw new Error('LLM provider failed');
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Parses an untrusted provider response into a typed ModelGeneration. All
 * fields are re-validated; no provider-internal values are echoed back.
 */
function parseChatResponse(
  body: unknown,
  expectedModel: string,
): { ok: true; value: ModelGeneration } | { ok: false; issues: readonly { path: string; message: string }[] } {
  const issues: { path: string; message: string }[] = [];
  const typed = body as ChatCompletionsResponse | undefined;

  if (!typed || typeof typed !== 'object') {
    return { ok: false, issues: [{ path: 'llmProvider', message: 'invalid response body' }] };
  }
  if (!Array.isArray(typed.choices) || typed.choices.length === 0) {
    return { ok: false, issues: [{ path: 'llmProvider.choices', message: 'must be a non-empty array' }] };
  }
  if (typed.model !== expectedModel) {
    issues.push({
      path: 'llmProvider.model',
      message: `LLM model mismatch: expected "${expectedModel}" but received "${String(typed.model)}"`,
    });
  }

  const choice = typed.choices[0];
  const message = choice && typeof choice === 'object' ? (choice as { message?: unknown }).message : undefined;
  const content = message && typeof message === 'object' && 'content' in message
    ? (message as { content?: unknown }).content
    : undefined;

  let text = '';
  if (typeof content === 'string') {
    text = content.trim();
  } else if (content !== undefined) {
    issues.push({ path: 'llmProvider.choices[0].message.content', message: 'must be a string' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  return { ok: true, value: { text, insufficientContext: text.length === 0 } };
}
