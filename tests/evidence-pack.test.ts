import { describe, expect, it } from 'vitest';
import {
  createEvidencePack,
  EvidencePack,
  printEvidencePackReport,
} from '../src/evidence-pack.js';
import type {
  BurnInConfig,
  BurnInResult,
  CostMetrics,
  EmbeddingDriftResult,
  EvidencePackConfig,
  GoNoGoDecision,
  ModelGovernanceResult,
  SloResult,
  TenantCostBreakdown,
} from '../src/types.js';
import type { AlertEvaluation } from '../src/types.js';

function makeBurnInResult(overrides: Partial<BurnInResult> = {}): BurnInResult {
  return {
    config: {
      durationMs: 3600000,
      targetQps: 10,
      targetLatencyP95Ms: 800,
      targetAvailability: 0.999,
      maxErrorRate: 0.01,
      targetRecallAtK: 0.85,
      recallK: 10,
      requireZeroSecurityFindings: true,
      requireZeroAuditLogLoss: true,
    },
    startedAt: '2026-01-01T00:00:00Z',
    endedAt: '2026-01-01T01:00:00Z',
    durationMs: 3600000,
    totalQueries: 1000,
    successfulQueries: 999,
    failedQueries: 1,
    queryResults: [],
    sloResults: [],
    allSlosPassed: true,
    queriesPerSecond: [],
    ...overrides,
  };
}

function makeSloResult(
  type: 'availability' | 'latency_p95' | 'error_rate' | 'recall_at_k',
  passed: boolean,
  value: number,
  target: number,
): SloResult {
  return {
    type,
    passed,
    value,
    target,
    lowerIsBetter: type === 'latency_p95' || type === 'error_rate',
    description: `${type}: ${value}`,
  };
}

function makeCostMetrics(overrides: Partial<CostMetrics> = {}): CostMetrics {
  return {
    totalCost: 10.0,
    totalEmbeddingCost: 2.0,
    totalGenerationCost: 5.0,
    totalIndexingCost: 1.0,
    totalRetrievalCost: 2.0,
    costPerQuery: 0.01,
    costPerIngestion: 0.05,
    queryCount: 1000,
    ingestionCount: 100,
    totalTokenCount: 50000,
    ...overrides,
  };
}

function makeDriftResult(
  overrides: Partial<EmbeddingDriftResult> = {},
): EmbeddingDriftResult {
  return {
    driftDetected: false,
    klDivergence: 0.01,
    threshold: 0.05,
    referenceModelVersion: 'prod-v1',
    candidateModelVersion: 'candidate-v2',
    checkedAt: '2026-01-01T00:00:00Z',
    recommendedAction: 'keep',
    sampleSize: 1000,
    ...overrides,
  };
}

function makeGovernanceResult(
  overrides: Partial<ModelGovernanceResult> = {},
): ModelGovernanceResult {
  return {
    decision: 'keep',
    selectedModelVersion: 'prod-v1',
    previousModelVersion: 'prod-v1',
    reindexRecommended: false,
    reason: 'No drift detected',
    decidedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAlertEvaluation(
  overrides: Partial<AlertEvaluation> = {},
): AlertEvaluation {
  return {
    metricPath: 'concurrency.active',
    value: 5,
    threshold: 10,
    breached: false,
    state: 'resolved',
    consecutiveBreaches: 0,
    severity: 'warning',
    description: 'Test alert',
    ...overrides,
  };
}

function makeEvidencePackConfig(
  overrides: Partial<EvidencePackConfig> = {},
): EvidencePackConfig {
  return {
    burnInResult: makeBurnInResult(),
    costMetrics: makeCostMetrics(),
    tenantCostBreakdown: [],
    driftResult: makeDriftResult(),
    governanceResult: makeGovernanceResult(),
    alertEvaluations: [],
    securityFindings: 0,
    soc2EvidenceComplete: true,
    gdprEvidenceComplete: true,
    residualRisks: [],
    deferredWork: [],
    ...overrides,
  };
}

describe('EvidencePack', () => {
  it('assembles evidence pack with all-go decision', () => {
    const config = makeEvidencePackConfig();
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('go');
    expect(pack.allSlosPassed).toBe(true);
    expect(pack.soc2EvidenceComplete).toBe(true);
    expect(pack.gdprEvidenceComplete).toBe(true);
    expect(pack.securityFindings).toBe(0);
    expect(pack.driftResult.driftDetected).toBe(false);
  });

  it('detects blocked SLO as no-go', () => {
    const config = makeEvidencePackConfig({
      burnInResult: makeBurnInResult({
        allSlosPassed: false,
        sloResults: [
          makeSloResult('availability', false, 0.95, 0.999),
        ],
      }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(pack.decision.blockingIssues.length).toBeGreaterThan(0);
    expect(pack.decision.blockingIssues[0]).toContain('SLO failed');
  });

  it('detects low availability as no-go', () => {
    const config = makeEvidencePackConfig({
      burnInResult: makeBurnInResult({
        sloResults: [
          makeSloResult('availability', false, 0.90, 0.999),
          makeSloResult('latency_p95', true, 100, 800),
          makeSloResult('error_rate', true, 0.001, 0.01),
          makeSloResult('recall_at_k', true, 0.90, 0.85),
        ],
        allSlosPassed: false,
      }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('Availability')),
    ).toBe(true);
  });

  it('detects high latency as no-go', () => {
    const config = makeEvidencePackConfig({
      burnInResult: makeBurnInResult({
        sloResults: [
          makeSloResult('availability', true, 0.999, 0.999),
          makeSloResult('latency_p95', false, 1500, 800),
          makeSloResult('error_rate', true, 0.001, 0.01),
          makeSloResult('recall_at_k', true, 0.90, 0.85),
        ],
        allSlosPassed: false,
      }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('P95 latency')),
    ).toBe(true);
  });

  it('detects missing SOC 2 evidence as no-go', () => {
    const config = makeEvidencePackConfig({
      soc2EvidenceComplete: false,
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('SOC 2')),
    ).toBe(true);
  });

  it('detects missing GDPR evidence as no-go', () => {
    const config = makeEvidencePackConfig({
      gdprEvidenceComplete: false,
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('GDPR')),
    ).toBe(true);
  });

  it('detects security findings as no-go', () => {
    const config = makeEvidencePackConfig({
      securityFindings: 3,
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('security finding')),
    ).toBe(true);
  });

  it('detects high cost per query as no-go', () => {
    const config = makeEvidencePackConfig({
      costMetrics: makeCostMetrics({ costPerQuery: 0.05 }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('Cost per query')),
    ).toBe(true);
  });

  it('detects drift with reindex as no-go', () => {
    const config = makeEvidencePackConfig({
      driftResult: makeDriftResult({
        driftDetected: true,
        klDivergence: 0.10,
        recommendedAction: 'reindex',
      }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('drift detected')),
    ).toBe(true);
  });

  it('detects model governance rollback as no-go', () => {
    const config = makeEvidencePackConfig({
      governanceResult: makeGovernanceResult({
        decision: 'rollback',
        reason: 'Model performance degraded',
      }),
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('rollback')),
    ).toBe(true);
  });

  it('detects critical alert firing as no-go', () => {
    const config = makeEvidencePackConfig({
      alertEvaluations: [
        makeAlertEvaluation({
          metricPath: 'circuitBreaker.state',
          value: 1,
          threshold: 0,
          breached: true,
          state: 'firing',
          severity: 'critical',
          description: 'Circuit breaker is open',
        }),
      ],
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('no-go');
    expect(
      pack.decision.blockingIssues.some((i) => i.includes('Critical alert')),
    ).toBe(true);
  });

  it('produces warnings for non-critical issues', () => {
    const config = makeEvidencePackConfig({
      driftResult: makeDriftResult({
        driftDetected: true,
        klDivergence: 0.06,
        recommendedAction: 'investigate',
      }),
      residualRisks: ['Residual risk example'],
      deferredWork: ['Deferred work example'],
    });
    const pack = createEvidencePack(config);

    expect(pack.decision.decision).toBe('go');
    expect(pack.decision.warnings.length).toBeGreaterThan(0);
  });

  it('printEvidencePackReport does not throw', () => {
    const config = makeEvidencePackConfig();
    const pack = createEvidencePack(config);
    expect(() => printEvidencePackReport(pack)).not.toThrow();
  });
});

describe('EvidencePack type export', () => {
  it('EvidencePack is exported as a type', () => {
    const config = makeEvidencePackConfig();
    const pack: EvidencePack = createEvidencePack(config);
    expect(pack).toBeInstanceOf(Object);
    expect(pack.assembledAt).toBeDefined();
    expect(pack.decision).toBeDefined();
  });
});
