import { describe, expect, it, vi } from 'vitest';
import {
  createQueryTransformer,
  bypassQueryTransformer,
  isQueryTransformationResult,
} from '../src/query-transform.js';
import type { LanguageModel, ModelGeneration } from '../src/generate.js';
import type {
  QueryTransformationOptions,
  QueryTransformationResult,
} from '../src/types.js';

function makeModel(generateImpl: (prompt: { system: string; user: string; evidence: string }) => Promise<ModelGeneration>): LanguageModel {
  return {
    model: 'test-lm',
    generate: vi.fn(generateImpl),
  } as LanguageModel;
}

function makeValidResult(variants: readonly string[]): QueryTransformationResult {
  return { variants, applied: variants.length > 1 };
}

describe('createQueryTransformer', () => {
  it('falls back to original query when model throws', async () => {
    const model = makeModel(async () => {
      throw new Error('model failure');
    });
    const transformer = createQueryTransformer(model);

    const result = await transformer('what is the policy?', { maxVariants: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['what is the policy?']);
    expect(result.value.applied).toBe(false);
  });

  it('produces variants when model returns valid output', async () => {
    const model = makeModel(async () => ({
      text: 'what is the policy?\npolicy details\ncoverage terms',
    }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('what is the policy?', { maxVariants: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.applied).toBe(true);
    expect(result.value.variants).toContain('what is the policy?');
    expect(result.value.variants).toContain('policy details');
    expect(result.value.variants).toContain('coverage terms');
    expect(model.generate).toHaveBeenCalledTimes(1);
  });

  it('caps variants at maxVariants', async () => {
    const model = makeModel(async () => ({
      text: 'v1\nv2\nv3\nv4\nv5',
    }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('query', { maxVariants: 3 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toHaveLength(3);
    expect(result.value.variants[0]).toBe('query'); // original anchored first
  });

  it('applies per-variant token budget', async () => {
    const model = makeModel(async () => ({
      text: 'this is a very long variant with many words that should be truncated',
    }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('query', { maxTokensPerVariant: 4 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Original query is anchored at index 0; truncated variant follows.
    // 4 tokens from "this is a very long variant with many words..." = "this is a very"
    expect(result.value.variants).toContain('this is a very');
  });

  it('deduplicates variants', async () => {
    const model = makeModel(async () => ({
      text: 'variant a\nvariant a\nvariant b\nvariant a',
    }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('query', { maxVariants: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['query', 'variant a', 'variant b']);
  });

  it('times out and falls back to original query', async () => {
    const model = makeModel(async () => {
      // Resolves slowly, well past the timeout.
      return new Promise((resolve) => {
        setTimeout(() => resolve({ text: 'late variant' }), 2000);
      });
    });
    const transformer = createQueryTransformer(model);

    const start = Date.now();
    const result = await transformer('query', { timeoutMs: 50 });
    const elapsed = Date.now() - start;

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['query']);
    expect(result.value.applied).toBe(false);
    expect(elapsed).toBeLessThan(5000); // should not wait for the slow model
  }, 10000);

  it('falls back when model returns empty output', async () => {
    const model = makeModel(async () => ({ text: '\n\n  \n' }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('query', { maxVariants: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['query']);
    expect(result.value.applied).toBe(false);
  });

  it('handles empty query input', async () => {
    const model = makeModel(async () => ({ text: 'some variant' }));
    const transformer = createQueryTransformer(model);

    const result = await transformer('', { maxVariants: 5 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['']);
    expect(result.value.applied).toBe(false);
  });
});

describe('bypassQueryTransformer', () => {
  it('always returns original query only with applied false', async () => {
    const transformer = bypassQueryTransformer();

    const result = await transformer('any query', { maxVariants: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.variants).toEqual(['any query']);
    expect(result.value.applied).toBe(false);
  });
});

describe('isQueryTransformationResult', () => {
  it('validates well-formed results', () => {
    expect(isQueryTransformationResult({ variants: ['a'], applied: true })).toBe(true);
  });

  it('rejects malformed results', () => {
    expect(isQueryTransformationResult(null)).toBe(false);
    expect(isQueryTransformationResult({ variants: ['a'] })).toBe(false); // missing applied
    expect(isQueryTransformationResult({ variants: ['a'], applied: 'yes' })).toBe(false);
    expect(isQueryTransformationResult({ variants: ['a', 123], applied: true })).toBe(false);
  });
});
