import type {
  RetrievalResult,
  Result,
  RerankerConfig,
} from './types.js';
import type { RetrieveRequest } from './retrieve.js';

/**
 * Source-of-truth keywords: Reranker, LexicalReranker, threshold,
 * minScore, refusal
 */

/**
 * Deterministic lexical reranker. Scores each result by token overlap between
 * the query and the chunk content (no external model, no network calls).
 *
 * Implements the existing `RetrievalReranker` hook contract:
 * - Re-ranks results by lexical overlap score (descending).
 * - Drops results below `minScore` threshold (empty-context refusal).
 * - Caps results at `maxResults`.
 * - Fail-closed: errors surface as Result issues; no partial success, no
 *   silent fallback. Never logs chunk content.
 */
export class LexicalReranker {
  readonly config: RerankerConfig;

  constructor(config: RerankerConfig = {}) {
    this.config = {
      minScore: config.minScore ?? 0,
      maxResults: config.maxResults ?? 20,
    };
  }

  async rerank(
    query: RetrieveRequest,
    results: readonly RetrievalResult[],
  ): Promise<Result<readonly RetrievalResult[]>> {
    const minScore = Math.max(0, this.config.minScore ?? 0);
    const maxResults = Math.max(1, this.config.maxResults ?? 20);

    if (!query.text || query.text.trim().length === 0) {
      return { ok: true, value: [] };
    }

    const queryTokens = tokenize(query.text);
    if (queryTokens.size === 0) {
      return { ok: true, value: [] };
    }

    const scored: Array<{ result: RetrievalResult; score: number }> = [];
    for (const result of results) {
      const contentTokens = tokenize(result.chunk.content);
      const overlap = intersectionSize(queryTokens, contentTokens);
      const score = contentTokens.size > 0 ? overlap / contentTokens.size : 0;
      scored.push({ result, score });
    }

    // Filter by minScore threshold (empty-context refusal).
    const passed = scored.filter((s) => s.score >= minScore);

    // Re-rank by score desc, then by chunk id for determinism.
    passed.sort(
      (a, b) => b.score - a.score || a.result.chunk.id.localeCompare(b.result.chunk.id),
    );

    // Cap at maxResults.
    const capped = passed.slice(0, maxResults);

    const reranked = capped.map((entry, idx) => ({
      ...entry.result,
      score: entry.score,
      rank: idx + 1,
    }));

    return { ok: true, value: reranked };
  }
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0),
  );
}

function intersectionSize(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) {
      count += 1;
    }
  }
  return count;
}
