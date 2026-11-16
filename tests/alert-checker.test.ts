import { describe, expect, it } from 'vitest';
import { AlertChecker } from '../src/alert-checker.js';
import type {
  AlertOperator,
  AlertThreshold,
  CacheMetrics,
  CircuitBreakerMetrics,
  ConcurrencyLimiterMetrics,
  RuntimeControlsMetrics,
} from '../src/types.js';

function makeMetrics(overrides: Partial<RuntimeControlsMetrics> = {}): RuntimeControlsMetrics {
  return {
    concurrency: {
      active: 0,
      queued: 0,
      completed: 0,
      rejected: 0,
      timeouts: 0,
      ...overrides.concurrency,
    },
    circuitBreaker: {
      state: 'closed',
      failures: 0,
      successes: 0,
      totalCalls: 0,
      trips: 0,
      ...overrides.circuitBreaker,
    },
    cache: {
      hits: 0,
      misses: 0,
      size: 0,
      maxSize: 100,
      ...overrides.cache,
    },
    ...overrides,
  };
}

describe('AlertChecker', () => {
  it('evaluates a threshold breach with gt operator', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'concurrency.rejected',
        operator: 'gt' as AlertOperator,
        threshold: 5,
        consecutiveBreaches: 1,
        severity: 'warning',
      },
    ]);

    const metrics = makeMetrics({
      concurrency: { active: 0, queued: 0, completed: 0, rejected: 10, timeouts: 0 },
    });
    const results = checker.evaluate(metrics);

    expect(results).toHaveLength(1);
    expect(results[0].breached).toBe(true);
    expect(results[0].state).toBe('firing');
    expect(results[0].value).toBe(10);
    expect(results[0].severity).toBe('warning');
  });

  it('evaluates a threshold non-breach with lte operator', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'concurrency.active',
        operator: 'lte' as AlertOperator,
        threshold: 5,
        consecutiveBreaches: 1,
        severity: 'info',
      },
    ]);

    const metrics = makeMetrics({
      concurrency: { active: 3, queued: 0, completed: 0, rejected: 0, timeouts: 0 },
    });
    const results = checker.evaluate(metrics);

    expect(results).toHaveLength(1);
    expect(results[0].breached).toBe(true);
    expect(results[0].state).toBe('firing');
  });

  it('tracks consecutive breaches across evaluations', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.trips',
        operator: 'gt' as AlertOperator,
        threshold: 0,
        consecutiveBreaches: 3,
        severity: 'critical',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'closed', failures: 0, successes: 0, totalCalls: 0, trips: 1 },
    });

    // First evaluation: 1 breach -> pending (threshold is 3)
    const r1 = checker.evaluate(metrics);
    expect(r1[0]!.state).toBe('pending');
    expect(r1[0]!.consecutiveBreaches).toBe(1);

    // Second evaluation: 2 breaches -> pending
    const r2 = checker.evaluate(metrics);
    expect(r2[0]!.state).toBe('pending');
    expect(r2[0]!.consecutiveBreaches).toBe(2);

    // Third evaluation: 3 breaches -> firing
    const r3 = checker.evaluate(metrics);
    expect(r3[0]!.state).toBe('firing');
    expect(r3[0]!.consecutiveBreaches).toBe(3);
  });

  it('resets state when threshold is no longer breached', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.trips',
        operator: 'gt' as AlertOperator,
        threshold: 0,
        consecutiveBreaches: 2,
        severity: 'warning',
      },
    ]);

    const metricsOpen = makeMetrics({
      circuitBreaker: { state: 'open', failures: 5, successes: 0, totalCalls: 5, trips: 3 },
    });
    const metricsClosed = makeMetrics({
      circuitBreaker: { state: 'closed', failures: 0, successes: 5, totalCalls: 5, trips: 0 },
    });

    checker.evaluate(metricsOpen); // firing
    checker.evaluate(metricsOpen); // firing
    expect(checker.getFiring(checker.evaluate(metricsOpen))).toHaveLength(1);

    checker.evaluate(metricsClosed); // pending
    checker.evaluate(metricsClosed); // resolved
    expect(checker.getFiring(checker.evaluate(metricsClosed))).toHaveLength(0);
  });

  it('getFiring returns only firing evaluations', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.state',
        operator: 'eq' as AlertOperator,
        threshold: 1,
        consecutiveBreaches: 1,
        severity: 'critical',
      },
      {
        metricPath: 'concurrency.active',
        operator: 'gt' as AlertOperator,
        threshold: 100,
        consecutiveBreaches: 1,
        severity: 'info',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'open', failures: 5, successes: 0, totalCalls: 5, trips: 3 },
      concurrency: { active: 5, queued: 0, completed: 0, rejected: 0, timeouts: 0 },
    });

    const evaluations = checker.evaluate(metrics);
    const firing = checker.getFiring(evaluations);
    expect(firing).toHaveLength(1);
    expect(firing[0].metricPath).toBe('circuitBreaker.state');
  });

  it('getBreached returns all breached evaluations', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.state',
        operator: 'eq' as AlertOperator,
        threshold: 1,
        consecutiveBreaches: 1,
        severity: 'critical',
      },
      {
        metricPath: 'concurrency.rejected',
        operator: 'gt' as AlertOperator,
        threshold: 5,
        consecutiveBreaches: 1,
        severity: 'warning',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'open', failures: 5, successes: 0, totalCalls: 5, trips: 3 },
      concurrency: { active: 0, queued: 0, completed: 0, rejected: 10, timeouts: 0 },
    });

    const evaluations = checker.evaluate(metrics);
    const breached = checker.getBreached(evaluations);
    expect(breached).toHaveLength(2);
  });

  it('resets all trackers', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.state',
        operator: 'eq' as AlertOperator,
        threshold: 1,
        consecutiveBreaches: 1,
        severity: 'critical',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'open', failures: 5, successes: 0, totalCalls: 5, trips: 3 },
    });

    checker.evaluate(metrics);
    checker.evaluate(metrics);
    expect(checker.getFiring(checker.evaluate(metrics))).toHaveLength(1);

    checker.resetAll();
    const afterReset = checker.evaluate(metrics);
    // After reset, first breach with threshold=1 goes straight to firing
    expect(afterReset[0].state).toBe('firing');
    expect(afterReset[0].consecutiveBreaches).toBe(1);
  });

  it('circuitBreaker state open maps to 1', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.state',
        operator: 'eq' as AlertOperator,
        threshold: 1,
        consecutiveBreaches: 1,
        severity: 'critical',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'open', failures: 1, successes: 0, totalCalls: 1, trips: 1 },
    });
    const evaluations = checker.evaluate(metrics);
    expect(evaluations[0].breached).toBe(true);
    expect(evaluations[0].value).toBe(1);
  });

  it('circuitBreaker state closed maps to 0', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'circuitBreaker.state',
        operator: 'eq' as AlertOperator,
        threshold: 1,
        consecutiveBreaches: 1,
        severity: 'critical',
      },
    ]);

    const metrics = makeMetrics({
      circuitBreaker: { state: 'closed', failures: 0, successes: 5, totalCalls: 5, trips: 0 },
    });
    const evaluations = checker.evaluate(metrics);
    expect(evaluations[0].breached).toBe(false);
    expect(evaluations[0].value).toBe(0);
  });

  it('handles unknown metric path gracefully', () => {
    const checker = new AlertChecker([
      {
        metricPath: 'nonexistent.metric',
        operator: 'gt' as AlertOperator,
        threshold: 0,
        consecutiveBreaches: 1,
        severity: 'info',
      },
    ]);

    const metrics = makeMetrics();
    const evaluations = checker.evaluate(metrics);
    expect(evaluations[0].breached).toBe(false);
    expect(evaluations[0].value).toBe(0);
  });
});
