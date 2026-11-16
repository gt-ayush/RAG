import type {
  AlertEvaluation,
  AlertOperator,
  AlertState,
  AlertThreshold,
  RuntimeControlsMetrics,
} from './types.js';

/**
 * Evaluates a single metric value against an alert threshold using the
 * configured operator.
 *
 * Source-of-truth keywords: alert threshold, metric evaluation, comparison,
 * operator, breach detection
 */
function evaluateThreshold(
  value: number,
  threshold: number,
  operator: AlertOperator,
): boolean {
  switch (operator) {
    case 'gt':
      return value > threshold;
    case 'lt':
      return value < threshold;
    case 'gte':
      return value >= threshold;
    case 'lte':
      return value <= threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

/**
 * Resolves a metric value from a nested metrics object using a dot-separated
 * path (e.g. 'circuitBreaker.state', 'concurrency.rejected').
 *
 * Source-of-truth keywords: metric path resolution, nested lookup, dot notation
 */
function resolveMetricPath(
  metrics: RuntimeControlsMetrics,
  path: string,
): number {
  const parts = path.split('.');
  let current: unknown = metrics;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return 0;
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (typeof current === 'number') {
    return current;
  }
  // Boolean circuit breaker state: treat 'open' as 1, else 0.
  if (current === true) {
    return 1;
  }
  if (current === false) {
    return 0;
  }
  if (typeof current === 'string') {
    return current === 'open' ? 1 : 0;
  }
  return 0;
}

/**
 * Tracks the state of a single alert threshold across evaluations. Maintains
 * a consecutive breach counter and transitions between resolved/pending/firing
 * states based on the configured breach count.
 *
 * Source-of-truth keywords: alert state, consecutive breaches, state machine,
 * pending, firing, resolved
 */
class AlertTracker {
  private readonly threshold: AlertThreshold;
  private consecutiveBreaches = 0;
  private state: AlertState = 'resolved';

  constructor(threshold: AlertThreshold) {
    this.threshold = threshold;
  }

  /**
   * Evaluates the threshold against the current metric value and updates
   * internal state. Returns the evaluation result.
   */
  evaluate(value: number): AlertEvaluation {
    const breached = evaluateThreshold(value, this.threshold.threshold, this.threshold.operator);

    if (breached) {
      this.consecutiveBreaches += 1;
    } else {
      this.consecutiveBreaches = 0;
    }

    // State transitions: resolved -> pending -> firing based on consecutive breaches.
    if (this.consecutiveBreaches >= this.threshold.consecutiveBreaches) {
      this.state = 'firing';
    } else if (this.consecutiveBreaches > 0) {
      this.state = 'pending';
    } else {
      this.state = 'resolved';
    }

    return {
      metricPath: this.threshold.metricPath,
      value,
      threshold: this.threshold.threshold,
      breached,
      state: this.state,
      consecutiveBreaches: this.consecutiveBreaches,
      severity: this.threshold.severity,
      description: `${this.threshold.metricPath} ${this.threshold.operator} ${this.threshold.threshold} (actual: ${value})`,
    };
  }

  /** Returns the current alert state without evaluating. */
  getState(): AlertState {
    return this.state;
  }

  /** Resets the tracker to resolved state. */
  reset(): void {
    this.consecutiveBreaches = 0;
    this.state = 'resolved';
  }
}

/**
 * Evaluates runtime controls metrics against a set of alert thresholds.
 * Maintains per-threshold state across evaluations (consecutive breaches,
 * pending/firing states).
 *
 * Source-of-truth keywords: alert checker, threshold evaluation, metrics,
 * alert state, firing, pending, resolved
 */
export class AlertChecker {
  private readonly trackers = new Map<string, AlertTracker>();

  constructor(private readonly thresholds: readonly AlertThreshold[]) {
    for (const threshold of thresholds) {
      this.trackers.set(threshold.metricPath, new AlertTracker(threshold));
    }
  }

  /**
   * Evaluates all thresholds against the given metrics snapshot. Returns an
   * array of evaluation results, one per threshold.
   */
  evaluate(metrics: RuntimeControlsMetrics): readonly AlertEvaluation[] {
    const evaluations: AlertEvaluation[] = [];
    for (const threshold of this.thresholds) {
      const tracker = this.trackers.get(threshold.metricPath);
      if (!tracker) continue;
      const value = resolveMetricPath(metrics, threshold.metricPath);
      evaluations.push(tracker.evaluate(value));
    }
    return evaluations;
  }

  /** Returns all evaluations that are currently in 'firing' state. */
  getFiring(evaluations: readonly AlertEvaluation[]): readonly AlertEvaluation[] {
    return evaluations.filter((e) => e.state === 'firing');
  }

  /** Returns all evaluations that are currently breached (pending or firing). */
  getBreached(evaluations: readonly AlertEvaluation[]): readonly AlertEvaluation[] {
    return evaluations.filter((e) => e.breached);
  }

  /** Resets all trackers to resolved state. */
  resetAll(): void {
    for (const tracker of this.trackers.values()) {
      tracker.reset();
    }
  }
}
