import {
  ConfigValidationError,
  type PipelineConfig,
  type Result,
  type ValidationIssue,
} from './types.js';

type Env = Readonly<Record<string, string | undefined>>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function readRequired(env: Env, key: string, issues: ValidationIssue[]): string | undefined {
  const value = env[key];
  if (!isNonEmptyString(value)) {
    issues.push({ path: key, message: 'is required and must be a non-empty string' });
    return undefined;
  }
  return value.trim();
}

function readOptional(env: Env, key: string): string | undefined {
  const value = env[key];
  return isNonEmptyString(value) ? value.trim() : undefined;
}

function validateUrl(value: string, key: string, issues: ValidationIssue[]): void {
  try {
    // eslint-disable-next-line no-new
    new URL(value);
  } catch {
    issues.push({ path: key, message: 'must be a valid URL' });
  }
}

/**
 * Parse and validate pipeline configuration from an environment-like object.
 * Does not read process.env directly so callers can control the boundary.
 * Never include secret values in thrown messages or returned issues.
 */
export function parsePipelineConfig(env: Env): Result<PipelineConfig> {
  const issues: ValidationIssue[] = [];

  const llmApiKey = readRequired(env, 'LLM_API_KEY', issues);
  const llmModel = readRequired(env, 'LLM_MODEL', issues);
  const llmBaseUrl = readOptional(env, 'LLM_BASE_URL');
  const llmTimeoutMs = readOptional(env, 'LLM_TIMEOUT_MS');
  const vectorDbUrl = readRequired(env, 'VECTOR_DB_URL', issues);
  const vectorDbApiKey = readOptional(env, 'VECTOR_DB_API_KEY');
  const embeddingModel = readRequired(env, 'EMBEDDING_MODEL', issues);
  const embeddingBaseUrl = readOptional(env, 'EMBEDDING_BASE_URL');
  const embeddingDimensions = readOptional(env, 'EMBEDDING_DIMENSIONS');
  const embeddingApiKey = readOptional(env, 'EMBEDDING_API_KEY');
  const embeddingTimeoutMs = readOptional(env, 'EMBEDDING_TIMEOUT_MS');

  if (vectorDbUrl) {
    validateUrl(vectorDbUrl, 'VECTOR_DB_URL', issues);
  }

  if (embeddingBaseUrl) {
    validateUrl(embeddingBaseUrl, 'EMBEDDING_BASE_URL', issues);
  }

  if (embeddingDimensions) {
    const parsed = Number(embeddingDimensions);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({ path: 'EMBEDDING_DIMENSIONS', message: 'must be a positive integer' });
    }
  }

  if (embeddingTimeoutMs) {
    const parsed = Number(embeddingTimeoutMs);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({ path: 'EMBEDDING_TIMEOUT_MS', message: 'must be a positive integer' });
    }
  }

  if (llmBaseUrl) {
    validateUrl(llmBaseUrl, 'LLM_BASE_URL', issues);
  }

  if (llmTimeoutMs) {
    const parsed = Number(llmTimeoutMs);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      issues.push({ path: 'LLM_TIMEOUT_MS', message: 'must be a positive integer' });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  // Safe after validation above.
  const config: PipelineConfig = {
    llm: {
      apiKey: llmApiKey as string,
      model: llmModel as string,
      ...(llmBaseUrl ? { baseUrl: llmBaseUrl } : {}),
      ...(llmTimeoutMs ? { timeoutMs: Number(llmTimeoutMs) } : {}),
    },
    vectorDb: {
      url: vectorDbUrl as string,
      ...(vectorDbApiKey ? { apiKey: vectorDbApiKey } : {}),
    },
    embedding: {
      model: embeddingModel as string,
      ...(embeddingBaseUrl ? { baseUrl: embeddingBaseUrl } : {}),
      ...(embeddingDimensions ? { dimensions: Number(embeddingDimensions) } : {}),
      ...(embeddingApiKey ? { apiKey: embeddingApiKey } : {}),
      ...(embeddingTimeoutMs ? { timeoutMs: Number(embeddingTimeoutMs) } : {}),
    },
  };

  return { ok: true, value: config };
}

/** Parse config or throw a ConfigValidationError with non-sensitive issue details. */
export function loadPipelineConfig(env: Env): PipelineConfig {
  const result = parsePipelineConfig(env);
  if (!result.ok) {
    throw new ConfigValidationError(result.issues);
  }
  return result.value;
}

/** Convenience boundary for Node runtimes. Pass a controlled env in tests. */
export function loadPipelineConfigFromProcessEnv(): PipelineConfig {
  return loadPipelineConfig(process.env);
}
