export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs?: number;
  retryable?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isRetryableProviderError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };
  const status = typeof e.status === 'number' ? e.status : undefined;
  if (status === 429 || status === 408 || (status !== undefined && status >= 500)) return true;
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'RATE_LIMIT'].includes(code)) {
    return true;
  }
  const name = typeof e.name === 'string' ? e.name.toLowerCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  return (
    name.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('temporar')
  );
}

export async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts));
  const baseDelayMs = Math.max(0, Math.trunc(options.baseDelayMs ?? 0));
  const retryable = options.retryable ?? isRetryableProviderError;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !retryable(error)) {
        throw error;
      }
      if (baseDelayMs > 0) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('operation failed after retries');
}
