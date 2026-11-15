import { describe, expect, it } from 'vitest';
import { loadPipelineConfig, parsePipelineConfig } from '../src/config.js';
import { ConfigValidationError } from '../src/types.js';

const validEnv = {
  LLM_API_KEY: 'test-llm-key',
  LLM_MODEL: 'test-model',
  VECTOR_DB_URL: 'https://vector.example.com',
  VECTOR_DB_API_KEY: 'test-vector-key',
  EMBEDDING_MODEL: 'test-embedding-model',
};

describe('parsePipelineConfig', () => {
  it('parses a valid environment into a typed config', () => {
    const result = parsePipelineConfig(validEnv);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toEqual({
      llm: { apiKey: 'test-llm-key', model: 'test-model' },
      vectorDb: { url: 'https://vector.example.com', apiKey: 'test-vector-key' },
      embedding: { model: 'test-embedding-model' },
    });
  });

  it('allows VECTOR_DB_API_KEY to be omitted', () => {
    const { VECTOR_DB_API_KEY: _omit, ...env } = validEnv;
    const result = parsePipelineConfig(env);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.vectorDb).toEqual({ url: 'https://vector.example.com' });
  });

  it('reports missing required values without leaking secrets', () => {
    const result = parsePipelineConfig({
      LLM_API_KEY: '',
      LLM_MODEL: '   ',
      VECTOR_DB_URL: '',
      EMBEDDING_MODEL: undefined,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.issues).toEqual(
      expect.arrayContaining([
        { path: 'LLM_API_KEY', message: 'is required and must be a non-empty string' },
        { path: 'LLM_MODEL', message: 'is required and must be a non-empty string' },
        { path: 'VECTOR_DB_URL', message: 'is required and must be a non-empty string' },
        {
          path: 'EMBEDDING_MODEL',
          message: 'is required and must be a non-empty string',
        },
      ]),
    );

    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain('secret');
  });

  it('reports invalid VECTOR_DB_URL format', () => {
    const result = parsePipelineConfig({ ...validEnv, VECTOR_DB_URL: 'not-a-url' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContainEqual({
      path: 'VECTOR_DB_URL',
      message: 'must be a valid URL',
    });
  });

  it('parses optional embedding provider fields', () => {
    const result = parsePipelineConfig({
      ...validEnv,
      EMBEDDING_BASE_URL: 'https://api.example.com/v1',
      EMBEDDING_DIMENSIONS: '1536',
      EMBEDDING_API_KEY: 'emb-key',
      EMBEDDING_TIMEOUT_MS: '10000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.embedding).toEqual({
      model: 'test-embedding-model',
      baseUrl: 'https://api.example.com/v1',
      dimensions: 1536,
      apiKey: 'emb-key',
      timeoutMs: 10000,
    });
  });

  it('parses optional LLM provider fields', () => {
    const result = parsePipelineConfig({
      ...validEnv,
      LLM_BASE_URL: 'https://api.example.com/v1',
      LLM_TIMEOUT_MS: '30000',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.llm).toEqual({
      apiKey: 'test-llm-key',
      model: 'test-model',
      baseUrl: 'https://api.example.com/v1',
      timeoutMs: 30000,
    });
  });

  it('reports invalid optional LLM provider fields', () => {
    const result = parsePipelineConfig({
      ...validEnv,
      LLM_BASE_URL: 'not-a-url',
      LLM_TIMEOUT_MS: '-5',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['LLM_BASE_URL', 'LLM_TIMEOUT_MS']),
    );
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain('secret');
  });

  it('reports invalid optional embedding provider fields', () => {
    const result = parsePipelineConfig({
      ...validEnv,
      EMBEDDING_BASE_URL: 'not-a-url',
      EMBEDDING_DIMENSIONS: 'not-a-number',
      EMBEDDING_TIMEOUT_MS: '-5',
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.path)).toEqual(
      expect.arrayContaining(['EMBEDDING_BASE_URL', 'EMBEDDING_DIMENSIONS', 'EMBEDDING_TIMEOUT_MS']),
    );
    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain('emb-key');
  });
});

describe('loadPipelineConfig', () => {
  it('returns config for valid input', () => {
    expect(loadPipelineConfig(validEnv).llm.model).toBe('test-model');
  });

  it('throws ConfigValidationError with non-sensitive issue details', () => {
    const secret = 'super-secret-api-key';
    try {
      loadPipelineConfig({ ...validEnv, LLM_API_KEY: '', VECTOR_DB_URL: 'bad-url' });
      throw new Error('expected ConfigValidationError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const err = error as ConfigValidationError;
      expect(err.issues.length).toBeGreaterThan(0);
      expect(err.message).toContain('Invalid configuration');
      expect(err.message).not.toContain(secret);
      for (const issue of err.issues) {
        expect(issue.message).not.toContain(secret);
      }
    }
  });
});
