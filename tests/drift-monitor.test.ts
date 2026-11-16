import { describe, expect, it } from 'vitest';
import {
  EmbeddingDriftMonitor,
  ModelGovernance,
  buildSnapshot,
  evaluateEmbeddingDrift,
  klDivergenceDiagonalGaussian,
} from '../src/drift-monitor.js';
import type {
  EmbeddingDriftConfig,
  EmbeddingDistributionSnapshot,
} from '../src/types.js';

function makeVector(dims: number, base: number): number[] {
  return Array.from({ length: dims }, (_, i) => base + i * 0.01);
}

function makeSnapshot(
  modelVersion: string,
  dims: number,
  base: number,
): EmbeddingDistributionSnapshot {
  const vectors = Array.from({ length: 100 }, () => makeVector(dims, base));
  return buildSnapshot(modelVersion, vectors);
}

describe('klDivergenceDiagonalGaussian', () => {
  it('returns 0 for identical distributions', () => {
    const snap = makeSnapshot('model-a', 4, 1.0);
    const kl = klDivergenceDiagonalGaussian(snap, snap);
    expect(kl).toBeCloseTo(0, 5);
  });

  it('returns positive KL for different distributions', () => {
    const snap1 = makeSnapshot('model-a', 4, 1.0);
    const snap2 = makeSnapshot('model-b', 4, 5.0);
    const kl = klDivergenceDiagonalGaussian(snap1, snap2);
    expect(kl).toBeGreaterThan(0);
  });

  it('returns 0 for empty distributions', () => {
    const empty: EmbeddingDistributionSnapshot = {
      modelVersion: 'empty',
      sampleSize: 0,
      dimensionMeans: [],
      dimensionVariances: [],
      capturedAt: new Date().toISOString(),
    };
    const snap = makeSnapshot('model-a', 4, 1.0);
    expect(klDivergenceDiagonalGaussian(empty, snap)).toBe(0);
    expect(klDivergenceDiagonalGaussian(snap, empty)).toBe(0);
  });
});

describe('buildSnapshot', () => {
  it('computes correct means and variances', () => {
    const vectors: number[][] = [[1, 2], [3, 4], [5, 6]];
    const snap = buildSnapshot('test', vectors);
    expect(snap.sampleSize).toBe(3);
    expect(snap.dimensionMeans).toEqual([3, 4]);
    // Sample variance: ((1-3)² + (3-3)² + (5-3)²) / (3-1) = 8/2 = 4
    expect(snap.dimensionVariances[0]).toBeCloseTo(4, 5);
    expect(snap.dimensionVariances[1]).toBeCloseTo(4, 5);
    expect(snap.modelVersion).toBe('test');
  });

  it('returns empty snapshot for no vectors', () => {
    const snap = buildSnapshot('test', []);
    expect(snap.sampleSize).toBe(0);
    expect(snap.dimensionMeans).toEqual([]);
    expect(snap.dimensionVariances).toEqual([]);
  });
});

describe('EmbeddingDriftMonitor', () => {
  const config: EmbeddingDriftConfig = {
    klDivergenceThreshold: 0.5,
    minSampleSize: 10,
    productionModelVersion: 'prod-v1',
    candidateModelVersion: 'candidate-v2',
  };

  it('detects drift when KL exceeds threshold', () => {
    // Reference: tight distribution around 0
    const refVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 0.0),
    );
    // Candidate: shifted distribution around 3
    const candVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 3.0),
    );

    const monitor = new EmbeddingDriftMonitor(config, refVectors);
    const result = monitor.checkDrift(candVectors);

    expect(result.driftDetected).toBe(true);
    expect(result.klDivergence).toBeGreaterThan(config.klDivergenceThreshold);
    expect(result.recommendedAction).toBe('reindex');
    expect(result.referenceModelVersion).toBe('prod-v1');
    expect(result.candidateModelVersion).toBe('candidate-v2');
    expect(result.sampleSize).toBe(100);
  });

  it('does not detect drift when distributions are similar', () => {
    const refVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 1.0),
    );
    const candVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 1.0),
    );

    const monitor = new EmbeddingDriftMonitor(config, refVectors);
    const result = monitor.checkDrift(candVectors);

    expect(result.driftDetected).toBe(false);
    expect(result.recommendedAction).toBe('keep');
  });

  it('returns investigate when no reference snapshot', () => {
    const monitor = new EmbeddingDriftMonitor(config);
    const result = monitor.checkDrift([
      makeVector(4, 1.0),
      makeVector(4, 2.0),
    ]);

    expect(result.driftDetected).toBe(false);
    expect(result.recommendedAction).toBe('investigate');
    expect(result.referenceModelVersion).toBe('prod-v1');
  });

  it('returns investigate when candidate sample is too small', () => {
    const refVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 1.0),
    );
    const monitor = new EmbeddingDriftMonitor(config, refVectors);
    const result = monitor.checkDrift([makeVector(4, 1.0)]); // only 1 sample < minSampleSize 10

    expect(result.driftDetected).toBe(false);
    expect(result.recommendedAction).toBe('investigate');
    expect(result.sampleSize).toBe(1);
  });

  it('getReferenceSnapshot returns the reference', () => {
    const refVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 1.0),
    );
    const monitor = new EmbeddingDriftMonitor(config, refVectors);
    const snap = monitor.getReferenceSnapshot();
    expect(snap).toBeDefined();
    expect(snap?.modelVersion).toBe('prod-v1');
    expect(snap?.sampleSize).toBe(100);
  });

  it('getReferenceSnapshot returns undefined when no reference', () => {
    const monitor = new EmbeddingDriftMonitor(config);
    expect(monitor.getReferenceSnapshot()).toBeUndefined();
  });
});

describe('ModelGovernance', () => {
  const allowedVersions = ['prod-v1', 'candidate-v2', 'candidate-v3'];

  it('rolls back when drift is detected', () => {
    const governance = new ModelGovernance('prod-v1', allowedVersions);
    const driftResult = {
      driftDetected: true,
      klDivergence: 1.5,
      threshold: 0.5,
      referenceModelVersion: 'prod-v1',
      candidateModelVersion: 'candidate-v2',
      checkedAt: new Date().toISOString(),
      recommendedAction: 'reindex',
      sampleSize: 100,
    };

    const result = governance.evaluate(driftResult);
    expect(result.decision).toBe('rollback');
    expect(result.selectedModelVersion).toBe('prod-v1');
    expect(result.reindexRecommended).toBe(true);
    expect(result.reason).toContain('drift detected');
  });

  it('approves candidate when no drift and version is allowed', () => {
    const governance = new ModelGovernance('prod-v1', allowedVersions);
    const driftResult = {
      driftDetected: false,
      klDivergence: 0.1,
      threshold: 0.5,
      referenceModelVersion: 'prod-v1',
      candidateModelVersion: 'candidate-v2',
      checkedAt: new Date().toISOString(),
      recommendedAction: 'keep',
      sampleSize: 100,
    };

    const result = governance.evaluate(driftResult);
    expect(result.decision).toBe('candidate_approved');
    expect(result.selectedModelVersion).toBe('candidate-v2');
    expect(result.reindexRecommended).toBe(false);
    expect(result.reason).toContain('approved');
  });

  it('keeps production when candidate is not in allowed list', () => {
    const governance = new ModelGovernance('prod-v1', allowedVersions);
    const driftResult = {
      driftDetected: false,
      klDivergence: 0.1,
      threshold: 0.5,
      referenceModelVersion: 'prod-v1',
      candidateModelVersion: 'unauthorized-v99',
      checkedAt: new Date().toISOString(),
      recommendedAction: 'keep',
      sampleSize: 100,
    };

    const result = governance.evaluate(driftResult);
    expect(result.decision).toBe('keep');
    expect(result.selectedModelVersion).toBe('prod-v1');
    expect(result.reindexRecommended).toBe(false);
    expect(result.reason).toContain('not in the allowed model versions');
  });

  it('keeps production when no candidate and no drift', () => {
    const governance = new ModelGovernance('prod-v1', allowedVersions);
    const driftResult = {
      driftDetected: false,
      klDivergence: 0.1,
      threshold: 0.5,
      referenceModelVersion: 'prod-v1',
      candidateModelVersion: undefined,
      checkedAt: new Date().toISOString(),
      recommendedAction: 'keep',
      sampleSize: 100,
    };

    const result = governance.evaluate(driftResult);
    expect(result.decision).toBe('keep');
    expect(result.selectedModelVersion).toBe('prod-v1');
    expect(result.reindexRecommended).toBe(false);
  });
});

describe('evaluateEmbeddingDrift', () => {
  it('returns drift result and governance result', () => {
    const config: EmbeddingDriftConfig = {
      klDivergenceThreshold: 0.5,
      minSampleSize: 10,
      productionModelVersion: 'prod-v1',
      candidateModelVersion: 'candidate-v2',
    };
    const allowedVersions = ['prod-v1', 'candidate-v2'];

    const refVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 1.0),
    );
    const candVectors = Array.from({ length: 100 }, () =>
      makeVector(4, 3.0),
    );

    const result = evaluateEmbeddingDrift(
      config,
      refVectors,
      candVectors,
      allowedVersions,
    );

    expect(result.driftResult.driftDetected).toBe(true);
    expect(result.governanceResult.decision).toBe('rollback');
    expect(result.governanceResult.selectedModelVersion).toBe('prod-v1');
    expect(result.governanceResult.reindexRecommended).toBe(true);
  });
});
