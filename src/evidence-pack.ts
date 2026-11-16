import type {
  AlertEvaluation,
  BurnInResult,
  CostMetrics,
  EmbeddingDriftResult,
  EvidencePackConfig,
  GoNoGoDecision,
  ModelGovernanceResult,
} from './types.js';
import type { TenantCostBreakdown } from './cost-tracking.js';

/**
 * Thresholds for go/no-go decision criteria.
 *
 * Source-of-truth keywords: evidence pack, go/no-go, decision criteria,
 * release readiness, compliance evidence
 */
const DEFAULT_THRESHOLDS = {
  /** Minimum availability fraction required for go. */
  minAvailability: 0.999,
  /** Maximum P95 latency in ms required for go. */
  maxLatencyP95Ms: 800,
  /** Maximum error rate fraction allowed. */
  maxErrorRate: 0.01,
  /** Minimum recall@K required. */
  minRecallAtK: 0.85,
  /** Maximum cost per query in USD. */
  maxCostPerQuery: 0.01,
  /** Maximum KL divergence allowed. */
  maxKlDivergence: 0.05,
};

/**
 * Aggregates all pipeline evidence (burn-in SLOs, cost metrics, drift
 * detection, model governance, alert evaluations, security findings, SOC 2
 * and GDPR evidence completeness) into a single evidence pack and produces a
 * go/no-go release decision.
 *
 * The go/no-go decision is fail-closed: if any blocking criterion is not met,
 * the decision is 'no-go' regardless of other passing metrics.
 *
 * Source-of-truth keywords: evidence pack, go/no-go, release readiness,
 * compliance evidence, SLO, drift detection, model governance
 */
export class EvidencePack {
  readonly config: EvidencePackConfig;
  decision: GoNoGoDecision | undefined;
  sloResults: readonly import('./types.js').SloResult[] = [];
  allSlosPassed = false;
  driftResult!: import('./types.js').EmbeddingDriftResult;
  governanceResult!: import('./types.js').ModelGovernanceResult;
  alertEvaluations: readonly AlertEvaluation[] = [];
  costMetrics!: CostMetrics;
  tenantCostBreakdown: readonly TenantCostBreakdown[] = [];
  securityFindings = 0;
  soc2EvidenceComplete = false;
  gdprEvidenceComplete = false;
  residualRisks: readonly string[] = [];
  deferredWork: readonly string[] = [];
  assembledAt = '';

  constructor(config: EvidencePackConfig) {
    this.config = config;
  }

  /**
   * Assembles the complete evidence pack and produces a go/no-go decision.
   *
   * The decision logic is:
   *   - BLOCKING (no-go): any SLO failure, SOC 2/GDPR evidence incomplete,
   *     embedding drift detected with reindex recommendation, any firing
   *     critical alerts, any security findings when zero required,
   *     cost per query exceeds maximum.
   *   - WARNINGS (go with warnings): drift detected with keep/investigate
   *     action, non-critical alerts firing, residual risks identified,
   *     deferred work items present.
   */
  evaluate(): GoNoGoDecision {
    const blockingIssues: string[] = [];
    const warnings: string[] = [];

    const {
      burnInResult,
      costMetrics,
      driftResult,
      governanceResult,
      alertEvaluations,
      securityFindings,
      soc2EvidenceComplete,
      gdprEvidenceComplete,
      residualRisks,
      deferredWork,
    } = this.config;

    // --- SLO evaluation (blocking) ---
    if (!burnInResult.allSlosPassed) {
      const failingSlos = burnInResult.sloResults.filter((s) => !s.passed);
      for (const slo of failingSlos) {
        blockingIssues.push(
          `SLO failed: ${slo.description} (value=${slo.value}, target=${slo.target})`,
        );
      }
    }

    // --- Availability (blocking) ---
    const availabilitySlo = burnInResult.sloResults.find(
      (s) => s.type === 'availability',
    );
    if (availabilitySlo && !availabilitySlo.passed) {
      blockingIssues.push(
        `Availability ${(availabilitySlo.value * 100).toFixed(2)}% below target ${(availabilitySlo.target * 100).toFixed(2)}%`,
      );
    }

    // --- Latency P95 (blocking) ---
    const latencySlo = burnInResult.sloResults.find(
      (s) => s.type === 'latency_p95',
    );
    if (latencySlo && !latencySlo.passed) {
      blockingIssues.push(
        `P95 latency ${latencySlo.value.toFixed(0)}ms exceeds target ${latencySlo.target.toFixed(0)}ms`,
      );
    }

    // --- Recall@K (blocking) ---
    const recallSlo = burnInResult.sloResults.find(
      (s) => s.type === 'recall_at_k',
    );
    if (recallSlo && !recallSlo.passed) {
      blockingIssues.push(
        `Recall@${this.config.burnInResult.config.recallK} ${(recallSlo.value * 100).toFixed(1)}% below target ${(recallSlo.target * 100).toFixed(1)}%`,
      );
    }

    // --- SOC 2 evidence (blocking) ---
    if (!soc2EvidenceComplete) {
      blockingIssues.push('SOC 2 Type II evidence incomplete (CC4/CC6/CC7)');
    }

    // --- GDPR evidence (blocking) ---
    if (!gdprEvidenceComplete) {
      blockingIssues.push('GDPR evidence incomplete');
    }

    // --- Security findings (blocking when zero required) ---
    if (securityFindings > 0) {
      blockingIssues.push(
        `${securityFindings} critical/high security finding(s) present`,
      );
    }

    // --- Cost per query (blocking if exceeds max) ---
    if (costMetrics.costPerQuery > DEFAULT_THRESHOLDS.maxCostPerQuery) {
      blockingIssues.push(
        `Cost per query $${costMetrics.costPerQuery.toFixed(4)} exceeds maximum $${DEFAULT_THRESHOLDS.maxCostPerQuery.toFixed(4)}`,
      );
    }

    // --- Embedding drift (blocking if reindex recommended) ---
    if (driftResult.driftDetected && driftResult.recommendedAction === 'reindex') {
      blockingIssues.push(
        `Embedding drift detected (KL=${driftResult.klDivergence.toFixed(4)} >= threshold=${driftResult.threshold}); re-index recommended`,
      );
    } else if (
      driftResult.driftDetected &&
      driftResult.recommendedAction === 'rollback'
    ) {
      blockingIssues.push(
        `Embedding drift detected (KL=${driftResult.klDivergence.toFixed(4)} >= threshold=${driftResult.threshold}); rollback recommended`,
      );
    } else if (driftResult.driftDetected) {
      warnings.push(
        `Embedding drift detected (KL=${driftResult.klDivergence.toFixed(4)} >= threshold=${driftResult.threshold}); investigate recommended`,
      );
    }

    // --- Model governance (blocking if rollback) ---
    if (governanceResult.decision === 'rollback') {
      blockingIssues.push(
        `Model governance rollback recommended: ${governanceResult.reason}`,
      );
    } else if (governanceResult.decision === 'candidate_approved') {
      warnings.push(
        `Candidate model approved: ${governanceResult.selectedModelVersion}`,
      );
    }

    // --- Alert evaluations (blocking if critical firing) ---
    const criticalAlerts = alertEvaluations.filter(
      (a) => a.state === 'firing' && a.severity === 'critical',
    );
    for (const alert of criticalAlerts) {
      blockingIssues.push(
        `Critical alert firing: ${alert.description}`,
      );
    }

    const warningAlerts = alertEvaluations.filter(
      (a) => a.state === 'firing' && a.severity === 'warning',
    );
    for (const alert of warningAlerts) {
      warnings.push(
        `Warning alert firing: ${alert.description}`,
      );
    }

    // --- Residual risks (warning) ---
    for (const risk of residualRisks) {
      warnings.push(`Residual risk: ${risk}`);
    }

    // --- Deferred work (warning) ---
    for (const work of deferredWork) {
      warnings.push(`Deferred work: ${work}`);
    }

    // --- Decision ---
    const decision: 'go' | 'no-go' = blockingIssues.length > 0 ? 'no-go' : 'go';

    // Confidence: higher when more evidence is available and fewer warnings
    const totalChecks =
      burnInResult.sloResults.length +
      (soc2EvidenceComplete ? 1 : 0) +
      (gdprEvidenceComplete ? 1 : 0) +
      alertEvaluations.length +
      1; // drift + governance
    const passedChecks =
      burnInResult.sloResults.filter((s) => s.passed).length +
      (soc2EvidenceComplete ? 1 : 0) +
      (gdprEvidenceComplete ? 1 : 0) +
      alertEvaluations.filter((a) => !a.breached).length +
      (!driftResult.driftDetected ? 1 : 0) +
      (governanceResult.decision !== 'rollback' ? 1 : 0);
    const confidence =
      totalChecks > 0
        ? Math.max(
            0,
            Math.min(1, passedChecks / totalChecks - warnings.length * 0.05),
          )
        : 0;

    const summary = decision === 'go'
      ? `All blocking criteria passed. ${passedChecks}/${totalChecks} checks passed. ${warnings.length} warning(s).`
      : `Blocking criteria failed: ${blockingIssues.length} issue(s). ${passedChecks}/${totalChecks} checks passed. ${warnings.length} warning(s).`;

    this.decision = {
      decision,
      confidence,
      blockingIssues,
      warnings,
      summary,
      decidedAt: new Date().toISOString(),
    };

    return this.decision;
  }

  /**
   * Assembles the complete EvidencePack from the configuration and evaluation.
   */
  assemble(): EvidencePack {
    const decision = this.evaluate();
    const {
      burnInResult,
      costMetrics,
      tenantCostBreakdown: tenantBreakdown,
      driftResult,
      governanceResult,
      alertEvaluations,
      securityFindings,
      soc2EvidenceComplete,
      gdprEvidenceComplete,
      residualRisks,
      deferredWork,
    } = this.config;

    this.sloResults = burnInResult.sloResults;
    this.allSlosPassed = burnInResult.allSlosPassed;
    this.driftResult = driftResult;
    this.governanceResult = governanceResult;
    this.alertEvaluations = alertEvaluations;
    this.costMetrics = costMetrics;
    this.tenantCostBreakdown = tenantBreakdown;
    this.securityFindings = securityFindings;
    this.soc2EvidenceComplete = soc2EvidenceComplete;
    this.gdprEvidenceComplete = gdprEvidenceComplete;
    this.residualRisks = residualRisks;
    this.deferredWork = deferredWork;
    this.assembledAt = new Date().toISOString();

    return this;
  }
}

/**
 * Convenience function: creates an EvidencePack from configuration and
 * returns the assembled pack with go/no-go decision.
 *
 * Source-of-truth keywords: evidence pack, go/no-go, assemble, release
 */
export function createEvidencePack(
  config: EvidencePackConfig,
): EvidencePack {
  const pack = new EvidencePack(config);
  return pack.assemble();
}

/**
 * Prints a human-readable evidence pack report.
 */
export function printEvidencePackReport(pack: EvidencePack): void {
  const decision = pack.decision!;
  console.log('\n=== Phase 20.3 — Evidence Pack & Go/No-Go Report ===');
  console.log(`Assembled:    ${pack.assembledAt}`);
  console.log(`Decision:     ${decision.decision.toUpperCase()}`);
  console.log(`Confidence:   ${(decision.confidence * 100).toFixed(1)}%`);
  console.log(`All SLOs:     ${pack.allSlosPassed ? 'PASS' : 'FAIL'}`);
  console.log(
    `SOC 2:        ${pack.soc2EvidenceComplete ? 'COMPLETE' : 'INCOMPLETE'}`,
  );
  console.log(
    `GDPR:         ${pack.gdprEvidenceComplete ? 'COMPLETE' : 'INCOMPLETE'}`,
  );
  console.log(`Drift:        ${pack.driftResult.driftDetected ? 'DETECTED' : 'NONE'}`);
  console.log(
    `Governance:   ${pack.governanceResult.decision}`,
  );
  console.log(`Security:     ${pack.securityFindings} finding(s)`);
  console.log(`Cost/query:   $${pack.costMetrics.costPerQuery.toFixed(4)}`);
  console.log(
    `Alerts:       ${pack.alertEvaluations.filter(
      (a) => a.state === 'firing',
    ).length} firing`,
  );

  if (decision.blockingIssues.length > 0) {
    console.log('\n--- Blocking Issues ---');
    for (const issue of decision.blockingIssues) {
      console.log(`  ✗ ${issue}`);
    }
  }

  if (decision.warnings.length > 0) {
    console.log('\n--- Warnings ---');
    for (const warning of decision.warnings) {
      console.log(`  ⚠ ${warning}`);
    }
  }

  console.log('========================================\n');
}
