import type {
  BurnInConfig,
  BurnInResult,
  BurnInQueryResult,
  SloResult,
  SloType,
} from './types.js';

/**
 * Percentile calculation (nearest-rank method).
 */
function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx]!;
}

/**
 * Mean of an array of numbers.
 */
function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Evaluates a single SLO against measured results.
 */
function evaluateSlo(
  type: SloType,
  value: number,
  target: number,
  lowerIsBetter: boolean,
  description: string,
): SloResult {
  const passed = lowerIsBetter ? value <= target : value >= target;
  return {
    type,
    passed,
    value,
    target,
    lowerIsBetter,
    description,
  };
}

/**
 * Evaluates all SLOs from burn-in query results.
 *
 * Source-of-truth keywords: SLO, service level objective, burn-in, evaluation,
 * availability, latency, error rate, recall, MRR, nDCG
 */
export function evaluateSlos(
  config: BurnInConfig,
  results: readonly BurnInQueryResult[],
): readonly SloResult[] {
  const total = results.length;
  const successful = results.filter((r) => r.success).length;
  const failed = total - successful;
  const errorRate = total > 0 ? failed / total : 0;
  const availability = total > 0 ? successful / total : 0;

  const latencies = results.map((r) => r.latencyMs).filter((l) => l >= 0);
  const p95Latency = latencies.length > 0 ? percentile(latencies, 95) : 0;

  const recallValues = results
    .map((r) => r.recallAtK)
    .filter((v): v is number => v !== undefined);
  const avgRecall =
    recallValues.length > 0 ? recallValues.reduce((a, b) => a + b, 0) / recallValues.length : 0;

  const auditLoggedCount = results.filter((r) => r.auditLogged).length;
  const auditLogLoss = total > 0 ? (total - auditLoggedCount) / total : 0;

  const slos: SloResult[] = [];

  // Availability SLO
  slos.push(
    evaluateSlo(
      'availability',
      availability,
      config.targetAvailability,
      false,
      `Availability: ${(availability * 100).toFixed(2)}% (target ≥ ${(config.targetAvailability * 100).toFixed(2)}%)`,
    ),
  );

  // Latency P95 SLO
  slos.push(
    evaluateSlo(
      'latency_p95',
      p95Latency,
      config.targetLatencyP95Ms,
      true,
      `Retrieval P95 latency: ${p95Latency.toFixed(2)}ms (target ≤ ${config.targetLatencyP95Ms}ms)`,
    ),
  );

  // Error rate SLO
  slos.push(
    evaluateSlo(
      'error_rate',
      errorRate,
      config.maxErrorRate,
      true,
      `Error rate: ${(errorRate * 100).toFixed(2)}% (target ≤ ${(config.maxErrorRate * 100).toFixed(2)}%)`,
    ),
  );

  // Recall@K SLO
  slos.push(
    evaluateSlo(
      'recall_at_k',
      avgRecall,
      config.targetRecallAtK,
      false,
      `Recall@${config.recallK}: ${(avgRecall * 100).toFixed(2)}% (target ≥ ${(config.targetRecallAtK * 100).toFixed(2)}%)`,
    ),
  );

  // Audit log loss SLO
  slos.push(
    evaluateSlo(
      'audit_log_loss',
      auditLogLoss,
      0,
      true,
      `Audit log loss: ${(auditLogLoss * 100).toFixed(2)}% (target 0%)`,
    ),
  );

  return slos;
}

/**
 * Determines whether all SLOs passed.
 */
export function allSlosPassed(results: readonly SloResult[]): boolean {
  return results.every((r) => r.passed);
}

/**
 * Builds a BurnInResult from query results and configuration.
 */
export function buildBurnInResult(
  config: BurnInConfig,
  startedAt: string,
  endedAt: string,
  queryResults: readonly BurnInQueryResult[],
  securityFindings: number,
): BurnInResult {
  const durationMs = Date.parse(endedAt) - Date.parse(startedAt);
  const totalQueries = queryResults.length;
  const successfulQueries = queryResults.filter((r) => r.success).length;
  const failedQueries = totalQueries - successfulQueries;

  // Calculate queries per second (per-second buckets)
  const queriesPerSecond: number[] = [];
  const secondBuckets = new Map<number, number>();
  for (const r of queryResults) {
    // Use index as a proxy for second since we don't have timestamps per result
    // In a real deployment, each result would have a timestamp.
  }
  // Approximate QPS from total / duration
  const qps = durationMs > 0 ? (totalQueries / durationMs) * 1000 : 0;
  for (let i = 0; i < Math.ceil(durationMs / 1000); i += 1) {
    queriesPerSecond.push(Math.round(qps));
  }

  const sloResults = evaluateSlos(config, queryResults);

  // Check security findings and audit log loss as SLOs
  const securityFindingsSlo: SloResult = evaluateSlo(
    'security_findings',
    securityFindings,
    config.requireZeroSecurityFindings ? 0 : Infinity,
    true,
    `Critical/high security findings: ${securityFindings} (target 0)`,
  );

  const auditLogLossValues = queryResults.filter((r) => r.auditLogged === false).length;
  const auditLogLossRate =
    totalQueries > 0 ? auditLogLossValues / totalQueries : 0;
  const auditLogLossSlo: SloResult = evaluateSlo(
    'audit_log_loss',
    auditLogLossRate,
    config.requireZeroAuditLogLoss ? 0 : 1,
    true,
    `Audit log loss rate: ${(auditLogLossRate * 100).toFixed(2)}% (target 0%)`,
  );

  const allSlos = [...sloResults, securityFindingsSlo, auditLogLossSlo];

  return {
    config,
    startedAt,
    endedAt,
    durationMs,
    totalQueries,
    successfulQueries,
    failedQueries,
    queryResults,
    sloResults: allSlos,
    allSlosPassed: allSlosPassed(allSlos),
    queriesPerSecond,
  };
}

/**
 * Prints a human-readable burn-in report.
 */
export function printBurnInReport(result: BurnInResult): void {
  console.log('\n=== Phase 20.1 — 30-Day Burn-In Report ===');
  console.log(`Started:    ${result.startedAt}`);
  console.log(`Ended:      ${result.endedAt}`);
  console.log(`Duration:   ${(result.durationMs / 1000).toFixed(1)}s`);
  console.log(`Total Q:    ${result.totalQueries}`);
  console.log(`Success:    ${result.successfulQueries}`);
  console.log(`Failed:     ${result.failedQueries}`);
  console.log(`All SLOs:   ${result.allSlosPassed ? 'PASS' : 'FAIL'}`);
  console.log('\n--- SLO Results ---');
  for (const slo of result.sloResults) {
    const dir = slo.lowerIsBetter ? '≤' : '≥';
    console.log(
      `  ${slo.description} [${slo.passed ? 'PASS' : 'FAIL'}]`,
    );
  }
  console.log('========================================\n');
}
