import type { LanguageModel, ModelGeneration } from './generate.js';
import type {
  QueryTransformationOptions,
  QueryTransformationResult,
  QueryTransformer,
  Result,
} from './types.js';

/** Rough token estimate by whitespace split; used only for budget enforcement. */
function estimateTokens(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function truncateTokens(text: string, maxTokens: number): string {
  const tokens = text.trim().split(/\s+/);
  if (tokens.length <= maxTokens) return text;
  return tokens.slice(0, maxTokens).join(' ');
}

/** Parse model output into deduplicated, non-empty variant queries. */
function parseVariants(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line, idx, arr) => arr.indexOf(line) === idx);
}

/** System prompt instructing the model to produce retrieval query variants. */
const SYSTEM_PROMPT =
  'You are a query transformation assistant for a retrieval-augmented generation system. ' +
  'Your task: given a user query, produce alternative query variants (rewrites, decompositions, expansions) ' +
  'that can be used to retrieve relevant evidence from a document index. ' +
  'Output one variant per line. Do not include numbering, bullets, quotes, or explanations. ' +
  'Each variant must be a self-contained search query. Keep variants concise and on-topic. ' +
  'Output only the variant queries, nothing else.';

function buildUserPrompt(query: string): string {
  return `User query: "${query}"\n\nProduce alternative query variants:`;
}

/**
 * Factory for a concrete `QueryTransformer` that uses a language model to
 * produce rewrite/decompose/expand variants.
 *
 * Behavior:
 * - Respects `QueryTransformationOptions`: maxVariants, maxTokensPerVariant, timeoutMs.
 * - Enforces a per-variant token budget (rough whitespace-based estimate).
 * - Deduplicates variants and always anchors the original query.
 * - Fail-closed bypass: on timeout, error, or empty output, returns the original
 *   query only with `applied: false`, so retrieval proceeds unchanged.
 *
 * Source-of-truth keywords: query transformation, rewrite, decompose, expand,
 * latency budget, token budget, bypass, fail-closed
 */
export function createQueryTransformer(
  model: LanguageModel,
  factoryOptions: QueryTransformationOptions = {},
): QueryTransformer {
  return async (query: string, options: QueryTransformationOptions = {}): Promise<Result<QueryTransformationResult>> => {
    // Call-time options override factory defaults.
    const maxVariants = Math.max(1, Math.trunc(options.maxVariants ?? factoryOptions.maxVariants ?? 3));
    const maxTokensPerVariant = Math.max(0, Math.trunc(options.maxTokensPerVariant ?? factoryOptions.maxTokensPerVariant ?? 0));
    const timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? factoryOptions.timeoutMs ?? 5000));

    if (!query || query.trim().length === 0) {
      return { ok: true, value: { variants: [query], applied: false } };
    }

    let generation: ModelGeneration;
    try {
      generation = await withTimeout(
        model.generate({
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(query),
          evidence: '',
        }),
        timeoutMs,
      );
    } catch {
      // Bypass path: transformer failure -> original query only, not applied.
      return { ok: true, value: { variants: [query], applied: false } };
    }

    const raw = typeof generation.text === 'string' ? generation.text : '';
    const variants = parseVariants(raw);

    if (variants.length === 0) {
      return { ok: true, value: { variants: [query], applied: false } };
    }

    // Apply per-variant token budget.
    const bounded =
      maxTokensPerVariant > 0
        ? variants.map((v) => truncateTokens(v, maxTokensPerVariant))
        : variants;

    // Deduplicate; anchor with original query; cap at maxVariants.
    const seen = new Set<string>();
    const finalVariants: string[] = [];
    const add = (v: string) => {
      const trimmed = v.trim();
      if (trimmed.length === 0 || seen.has(trimmed)) return;
      seen.add(trimmed);
      finalVariants.push(trimmed);
    };

    add(query);
    for (const v of bounded) add(v);

    const trimmed = finalVariants.slice(0, maxVariants);

    return {
      ok: true,
      value: {
        variants: trimmed,
        applied: trimmed.length > 1 || trimmed[0] !== query,
      },
    };
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('query transformation timeout')), timeoutMs);
  });
  return Promise.race([promise, timeout]);
}

/** Build a no-op transformer that always returns the original query (bypass). */
export function bypassQueryTransformer(): QueryTransformer {
  return async (query: string) => ({
    ok: true,
    value: { variants: [query], applied: false },
  });
}

/** Type guard to validate a QueryTransformationResult shape from untrusted input. */
export function isQueryTransformationResult(value: unknown): value is QueryTransformationResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.variants) &&
    v.variants.every((item) => typeof item === 'string') &&
    typeof v.applied === 'boolean'
  );
}
