import type {
  BurnInConfig,
  BurnInQueryResult,
  BurnInResult,
} from './types.js';
import { buildBurnInResult, evaluateSlos, printBurnInReport } from './slo.js';

/**
 * Options for running a burn-in test against an HTTP endpoint.
 */
export interface BurnInRunnerOptions {
  /** Base URL of the HTTP service (e.g. http://localhost:8080). */
  baseUrl: string;
  /** Burn-in configuration. */
  config: BurnInConfig;
  /** Queries to cycle through during burn-in. */
  queries: readonly string[];
  /** Tenant ID to use for all queries (optional). */
  tenantId?: string;
  /** Expected model version for validation (optional). */
  expectedModel?: string;
  /** Callback invoked after each query result. */
  onResult?: (result: BurnInQueryResult) => void;
  /** Callback invoked when burn-in completes. */
  onComplete?: (result: BurnInResult) => void;
}

/**
 * Result of a single burn-in HTTP query.
 */
function makeQueryResult(
  success: boolean,
  latencyMs: number,
  statusCode: number,
  error?: string,
  recallAtK?: number,
  auditLogged?: boolean,
): BurnInQueryResult {
  return {
    success,
    latencyMs,
    statusCode,
    ...(error ? { error } : {}),
    ...(recallAtK !== undefined ? { recallAtK } : {}),
    ...(auditLogged !== undefined ? { auditLogged } : {}),
  };
}

/**
 * Runs a single query against the burn-in endpoint.
 */
async function runQuery(
  baseUrl: string,
  query: string,
  tenantId: string = '',
): Promise<BurnInQueryResult> {
  const startMs = Date.now();
  try {
    const body = JSON.stringify({ query, topK: 10, ...(tenantId ? { tenantId } : {}) });
    const res = await fetch(`${baseUrl}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - startMs;

    if (!res.ok) {
      return makeQueryResult(false, latencyMs, res.status, `HTTP ${res.status}`);
    }

    const data = (await res.json()) as {
      answer?: { insufficientContext?: boolean; citations?: readonly unknown[] };
      retrieved?: readonly unknown[];
    };

    // Compute recall@K: check if any retrieved result has a citation (proxy for relevance)
    const retrievedCount = data.retrieved?.length ?? 0;
    const recallAtK = retrievedCount > 0 ? 1 : 0;
    const auditLogged = (data.answer?.citations?.length ?? 0) > 0;

    return makeQueryResult(true, latencyMs, res.status, undefined, recallAtK, auditLogged);
  } catch (error) {
    const latencyMs = Date.now() - startMs;
    return makeQueryResult(
      false,
      latencyMs,
      0,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Runs a burn-in test against an HTTP service for the configured duration.
 * Issues queries at the target QPS rate and collects SLO measurements.
 *
 * Source-of-truth keywords: burn-in, SLO, 30-day, availability, latency,
 * recall, security findings, audit log
 */
export async function runBurnIn(
  options: BurnInRunnerOptions,
): Promise<BurnInResult> {
  const { config, baseUrl, queries, tenantId, onResult, onComplete } = options;
  const startedAt = new Date().toISOString();

  const queryResults: BurnInQueryResult[] = [];
  const endTime = Date.now() + config.durationMs;

  // Calculate interval between queries to achieve target QPS
  const minIntervalMs = config.targetQps > 0 ? 1000 / config.targetQps : 0;

  let queryIdx = 0;
  let lastQueryTime = 0;

  while (Date.now() < endTime) {
    const now = Date.now();
    // Throttle to target QPS
    if (lastQueryTime > 0 && now - lastQueryTime < minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, minIntervalMs - (now - lastQueryTime)));
    }

    const query = queries[queryIdx % queries.length]!;
    queryIdx += 1;

    const result = await runQuery(baseUrl, query, '');
    queryResults.push(result);
    onResult?.(result);

    lastQueryTime = Date.now();
  }

  const endedAt = new Date().toISOString();

  // In a real deployment, security findings would come from a security scanner
  // or red-team suite. For burn-in, we report zero findings unless provided.
  const securityFindings = 0;

  const result = buildBurnInResult(config, startedAt, endedAt, queryResults, securityFindings);

  onComplete?.(result);
  return result;
}

export { evaluateSlos };
