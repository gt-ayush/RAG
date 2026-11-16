import type {
  EmbeddingDriftConfig,
  EmbeddingDriftResult,
  EmbeddingDistributionSnapshot,
  EmbeddingVector,
  ModelGovernanceResult,
  ModelVersionDecision,
} from './types.js';

/**
 * Computes the Kullback-Leibler divergence between two multivariate normal
 * distributions approximated from embedding samples.
 *
 * For two multivariate normal distributions N(mu1, sigma1) and N(mu2, sigma2),
 * KL divergence is:
 *   KL = 0.5 * ( tr(sigma2^-1 * sigma1) + (mu2 - mu1)^T sigma2^-1 (mu2 - mu1) - k + ln(det(sigma2) / det(sigma1)) )
 *
 * We use a diagonal covariance approximation (independent dimensions) for
 * tractability, which reduces to a per-dimension sum.
 *
 * Source-of-truth keywords: embedding drift, KL divergence, model governance,
 * rollback, reindex, version pinning
 */
export function klDivergenceDiagonalGaussian(
  reference: EmbeddingDistributionSnapshot,
  candidate: EmbeddingDistributionSnapshot,
): number {
  const k = reference.dimensionMeans.length;
  if (k === 0 || k !== candidate.dimensionMeans.length) {
    return 0;
  }

  let kl = 0;
  for (let i = 0; i < k; i += 1) {
    const mu1 = reference.dimensionMeans[i]!;
    const mu2 = candidate.dimensionMeans[i]!;
    const var1 = Math.max(reference.dimensionVariances[i]!, 1e-9);
    const var2 = Math.max(candidate.dimensionVariances[i]!, 1e-9);

    // Per-dimension KL for diagonal Gaussians:
    // 0.5 * ( var1/var2 + (mu2-mu1)^2/var2 - 1 + ln(var2/var1) )
    kl +=
      0.5 *
      (var1 / var2 +
        ((mu2 - mu1) * (mu2 - mu1)) / var2 -
        1 +
        Math.log(var2 / var1));
  }
  return kl;
}

/**
 * Builds an embedding distribution snapshot from a set of embedding vectors.
 * Computes per-dimension mean and variance (sample variance, Bessel-corrected).
 */
export function buildSnapshot(
  modelVersion: string,
  vectors: readonly EmbeddingVector[],
): EmbeddingDistributionSnapshot {
  const n = vectors.length;
  if (n === 0) {
    return {
      modelVersion,
      sampleSize: 0,
      dimensionMeans: [],
      dimensionVariances: [],
      capturedAt: new Date().toISOString(),
    };
  }

  const dims = vectors[0]!.length;
  const means = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i += 1) {
      means[i] += v[i]!;
    }
  }
  for (let i = 0; i < dims; i += 1) {
    means[i] /= n;
  }

  const variances = new Array(dims).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dims; i += 1) {
      const d = v[i]! - means[i];
      variances[i] += d * d;
    }
  }
  for (let i = 0; i < dims; i += 1) {
    variances[i] = n > 1 ? variances[i] / (n - 1) : 0;
  }

  return {
    modelVersion,
    sampleSize: n,
    dimensionMeans: means,
    dimensionVariances: variances,
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Monitors embedding drift between a reference (production) distribution and
 * a candidate distribution. Computes KL divergence and recommends an action
 * based on a configurable threshold.
 *
 * Source-of-truth keywords: embedding drift, KL divergence, model drift,
 * drift threshold, drift detection
 */
export class EmbeddingDriftMonitor {
  private readonly config: EmbeddingDriftConfig;
  private readonly referenceSnapshot: EmbeddingDistributionSnapshot | undefined;

  constructor(config: EmbeddingDriftConfig, referenceVectors?: readonly EmbeddingVector[]) {
    this.config = config;
    this.referenceSnapshot = referenceVectors
      ? buildSnapshot(config.productionModelVersion, referenceVectors)
      : undefined;
  }

  /**
   * Checks whether the candidate embedding distribution has drifted from the
   * reference distribution. Returns a drift result with a recommended action.
   *
   * Fail-closed: if no reference snapshot exists or the candidate sample is
   * too small, returns driftDetected=false with a recommended action of
   * 'investigate'.
   */
  checkDrift(candidateVectors: readonly EmbeddingVector[]): EmbeddingDriftResult {
    if (!this.referenceSnapshot) {
      return {
        driftDetected: false,
        klDivergence: 0,
        threshold: this.config.klDivergenceThreshold,
        referenceModelVersion: this.config.productionModelVersion,
        candidateModelVersion: this.config.candidateModelVersion ?? undefined,
        checkedAt: new Date().toISOString(),
        recommendedAction: 'investigate',
        sampleSize: candidateVectors.length,
      };
    }

    if (candidateVectors.length < this.config.minSampleSize) {
      return {
        driftDetected: false,
        klDivergence: 0,
        threshold: this.config.klDivergenceThreshold,
        referenceModelVersion: this.config.productionModelVersion,
        candidateModelVersion: this.config.candidateModelVersion ?? undefined,
        checkedAt: new Date().toISOString(),
        recommendedAction: 'investigate',
        sampleSize: candidateVectors.length,
      };
    }

    const candidateSnapshot = buildSnapshot(
      this.config.candidateModelVersion ?? this.config.productionModelVersion,
      candidateVectors,
    );

    const kl = klDivergenceDiagonalGaussian(this.referenceSnapshot, candidateSnapshot);
    const driftDetected = kl > this.config.klDivergenceThreshold;

    let recommendedAction: EmbeddingDriftResult['recommendedAction'] = 'keep';
    if (driftDetected) {
      recommendedAction = 'reindex';
    }

    return {
      driftDetected,
      klDivergence: kl,
      threshold: this.config.klDivergenceThreshold,
      referenceModelVersion: this.config.productionModelVersion,
      candidateModelVersion: this.config.candidateModelVersion ?? undefined,
      checkedAt: new Date().toISOString(),
      recommendedAction,
      sampleSize: candidateVectors.length,
    };
  }

  /** Returns the reference snapshot, if one was configured. */
  getReferenceSnapshot(): EmbeddingDistributionSnapshot | undefined {
    return this.referenceSnapshot;
  }
}

/**
 * Evaluates whether to keep the current production model, roll back to a
 * previous version, or approve a candidate, based on drift results and
 * governance rules.
 *
 * Source-of-truth keywords: model governance, rollback, model version,
 * candidate approval, reindex recommendation
 */
export class ModelGovernance {
  private readonly productionModelVersion: string;
  private readonly allowedModelVersions: readonly string[];

  constructor(
    productionModelVersion: string,
    allowedModelVersions: readonly string[],
  ) {
    this.productionModelVersion = productionModelVersion;
    this.allowedModelVersions = allowedModelVersions;
  }

  /**
   * Makes a model version decision based on a drift result.
   *
   * - If drift is detected and the candidate is not the production version,
   *   recommend rollback to production and re-index.
   * - If drift is not detected and a candidate is being evaluated, approve
   *   the candidate.
   * - Otherwise, keep the current production version.
   */
  evaluate(driftResult: EmbeddingDriftResult): ModelGovernanceResult {
    const { driftDetected, candidateModelVersion } = driftResult;

    let decision: ModelVersionDecision = 'keep';
    let selectedModelVersion = this.productionModelVersion;
    let reindexRecommended = false;
    let reason: string;

    if (driftDetected) {
      decision = 'rollback';
      selectedModelVersion = this.productionModelVersion;
      reindexRecommended = true;
      reason =
        `Embedding drift detected (KL=${driftResult.klDivergence.toFixed(4)} >= threshold=${driftResult.threshold}); rolling back to production model ${this.productionModelVersion} and recommending re-index.`;
    } else if (
      candidateModelVersion &&
      candidateModelVersion !== this.productionModelVersion
    ) {
      if (this.allowedModelVersions.includes(candidateModelVersion)) {
        decision = 'candidate_approved';
        selectedModelVersion = candidateModelVersion;
        reindexRecommended = false;
        reason = `No drift detected for candidate model ${candidateModelVersion}; candidate approved for use.`;
      } else {
        decision = 'keep';
        selectedModelVersion = this.productionModelVersion;
        reindexRecommended = false;
        reason = `Candidate model ${candidateModelVersion} is not in the allowed model versions list; keeping production model ${this.productionModelVersion}.`;
      }
    } else {
      reason = `No drift detected; keeping production model ${this.productionModelVersion}.`;
    }

    return {
      decision,
      selectedModelVersion,
      previousModelVersion: this.productionModelVersion,
      reindexRecommended,
      reason,
      decidedAt: new Date().toISOString(),
    };
  }

  /** Returns the current production model version. */
  getProductionModelVersion(): string {
    return this.productionModelVersion;
  }

  /** Returns the list of allowed model versions. */
  getAllowedModelVersions(): readonly string[] {
    return this.allowedModelVersions;
  }
}

/**
 * Convenience function: builds a drift monitor from reference vectors and
 * evaluates governance in one call.
 *
 * Source-of-truth keywords: drift monitor, model governance, evaluate drift,
 * rollback decision
 */
export function evaluateEmbeddingDrift(
  config: EmbeddingDriftConfig,
  referenceVectors: readonly EmbeddingVector[],
  candidateVectors: readonly EmbeddingVector[],
  allowedModelVersions: readonly string[],
): { driftResult: EmbeddingDriftResult; governanceResult: ModelGovernanceResult } {
  const monitor = new EmbeddingDriftMonitor(config, referenceVectors);
  const driftResult = monitor.checkDrift(candidateVectors);
  const governance = new ModelGovernance(
    config.productionModelVersion,
    allowedModelVersions,
  );
  const governanceResult = governance.evaluate(driftResult);
  return { driftResult, governanceResult };
}
