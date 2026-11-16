import { describe, expect, it } from 'vitest';
import { PrometheusExporter } from '../src/prometheus.js';
import { MetricsRecorder } from '../src/observability.js';
import { CostMetricsTracker, DefaultCostConfig } from '../src/cost-tracking.js';
import { RuntimeControls } from '../src/runtime-controls.js';

describe('PrometheusExporter', () => {
  it('exports empty metrics when no data', () => {
    const metrics = new MetricsRecorder();
    const exporter = new PrometheusExporter(metrics);
    const output = exporter.export();

    expect(output).toBe('');
  });

  it('exports counter metrics', () => {
    const metrics = new MetricsRecorder();
    metrics.increment('http_requests_total', 5);
    metrics.increment('http_requests_total', 3);

    const exporter = new PrometheusExporter(metrics);
    const output = exporter.export();

    expect(output).toContain('# HELP http_requests_total Counter metric');
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).toContain('http_requests_total 8');
  });

  it('exports timing metrics as histogram', () => {
    const metrics = new MetricsRecorder();
    metrics.timing('retrieval.ms', 10);
    metrics.timing('retrieval.ms', 30);
    metrics.timing('retrieval.ms', 50);

    const exporter = new PrometheusExporter(metrics);
    const output = exporter.export();

    expect(output).toContain('# HELP retrieval_ms Timing metric');
    expect(output).toContain('# TYPE retrieval_ms histogram');
    expect(output).toContain('retrieval_ms_count 3');
    expect(output).toContain('retrieval_ms_sum 90');
    expect(output).toContain('retrieval_ms_bucket{le="+Inf"} 3');
  });

  it('exports cost metrics', () => {
    const metrics = new MetricsRecorder();
    const costTracker = new CostMetricsTracker(DefaultCostConfig);

    // Track some costs
    costTracker.getEmbeddingTracker().track(['hello world'], 'test-embed');
    costTracker.getQueryTracker().track(0.01, 0.02, 0.03);

    const exporter = new PrometheusExporter(metrics, costTracker);
    const output = exporter.export();

    expect(output).toContain('# HELP rag_cost_total Total cost in USD');
    expect(output).toContain('# TYPE rag_cost_total counter');
    expect(output).toContain('rag_cost_total ');
    expect(output).toContain('# HELP rag_cost_per_query Cost per query in USD');
    expect(output).toContain('# TYPE rag_cost_per_query gauge');
    expect(output).toContain('rag_cost_per_query ');
    expect(output).toContain('# HELP rag_query_count Total number of queries');
    expect(output).toContain('rag_query_count ');
  });

  it('exports runtime controls metrics', async () => {
    const metrics = new MetricsRecorder();
    const runtimeControls = new RuntimeControls({
      concurrency: { maxConcurrent: 10, maxQueueSize: 5, acquireTimeoutMs: 1000 },
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 10000, halfOpenMaxAttempts: 1 },
      cache: { maxSize: 100, ttlMs: 60000 },
    });

    // Generate cache misses and hits via execute()
    await runtimeControls.execute('key1', async () => 'value1'); // miss
    await runtimeControls.execute('key1', async () => 'value1'); // hit
    await runtimeControls.execute('key2', async () => 'value2'); // miss

    // Trigger circuit breaker failures (3 failures trips the breaker)
    for (let i = 0; i < 3; i += 1) {
      try {
        await runtimeControls.breaker.execute(async () => {
          throw new Error('fail');
        });
      } catch {
        // expected
      }
    }

    const exporter = new PrometheusExporter(metrics, undefined, runtimeControls);
    const output = exporter.export();

    expect(output).toContain('# HELP rag_concurrency_active Current number of concurrent operations');
    expect(output).toContain('# TYPE rag_concurrency_active gauge');
    // All operations completed, so active is 0
    expect(output).toContain('rag_concurrency_active 0');
    expect(output).toContain('# HELP rag_circuit_breaker_state Current circuit breaker state');
    expect(output).toContain('rag_circuit_breaker_state 1'); // open after 3 failures
    expect(output).toContain('# HELP rag_circuit_breaker_failures Total circuit breaker failures');
    expect(output).toContain('rag_circuit_breaker_failures 3');
    expect(output).toContain('# HELP rag_circuit_breaker_trips Total circuit breaker trips');
    expect(output).toContain('rag_circuit_breaker_trips 1');
    expect(output).toContain('# HELP rag_cache_hits Total cache hits');
    expect(output).toContain('rag_cache_hits 1');
    expect(output).toContain('# HELP rag_cache_misses Total cache misses');
    expect(output).toContain('rag_cache_misses 2');
  });

  it('includes cost metrics when tracker is provided', () => {
    const metrics = new MetricsRecorder();
    const costTracker = new CostMetricsTracker(DefaultCostConfig);
    costTracker.getEmbeddingTracker().track(['hello world'], 'test-model');
    costTracker.getQueryTracker().track(0.01, 0.02, 0.03);

    const exporter = new PrometheusExporter(metrics, costTracker);
    const output = exporter.export();

    expect(output).toContain('# HELP rag_cost_total Total cost in USD');
    expect(output).toContain('rag_cost_total ');
    expect(output).toContain('# HELP rag_cost_per_query Cost per query in USD');
    expect(output).toContain('rag_cost_per_query ');
    expect(output).toContain('# HELP rag_query_count Total number of queries');
    expect(output).toContain('rag_query_count 1');
  });

  it('output is valid Prometheus text format', () => {
    const metrics = new MetricsRecorder();
    metrics.increment('test_counter', 42);

    const exporter = new PrometheusExporter(metrics);
    const output = exporter.export();

    // Check that lines don't have trailing whitespace
    const lines = output.split('\n');
    for (const line of lines) {
      expect(line).not.toMatch(/\s$/);
    }
  });

  it('handles empty metrics gracefully', () => {
    const metrics = new MetricsRecorder();
    const exporter = new PrometheusExporter(metrics);
    const output = exporter.export();

    // Empty metrics should produce empty output
    expect(output).toBe('');
  });
});
