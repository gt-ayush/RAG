import type {
  AuditEvent,
  AuditEventType,
  AuditLog,
  AuditLogConfig,
  AuditRedactionLevel,
} from './types.js';
import { CostMetricsTracker } from './cost-tracking.js';
import { MetricsRecorder } from './observability.js';
import { RuntimeControls } from './runtime-controls.js';

/**
 * Escapes a label value for Prometheus text exposition format.
 * Escapes backslashes, double quotes, and newlines.
 */
function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

/**
 * Escapes a metric name for Prometheus text exposition format.
 * Metric names must match [a-zA-Z_:][a-zA-Z0-9_:]* .
 */
function sanitizeMetricName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

/**
 * Formats a metric name with optional labels.
 * Format: name{label1="value1",label2="value2"}
 */
function formatMetricName(name: string, labels?: Record<string, string>): string {
  if (!labels || Object.keys(labels).length === 0) {
    return name;
  }
  const labelPairs = Object.entries(labels)
    .map(([k, v]) => `${k}="${escapeLabelValue(v)}"`)
    .join(',');
  return `${name}{${labelPairs}}`;
}

/**
 * Converts a value to a Prometheus-compatible string representation.
 */
function formatValue(value: number): string {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 'NaN';
  }
  return value.toString();
}

/**
 * PrometheusExporter converts internal metrics into Prometheus text exposition format.
 *
 * Source-of-truth keywords: observability, metrics, Prometheus, exposition format, SLO
 */
export class PrometheusExporter {
  private readonly metrics: MetricsRecorder;
  private readonly costTracker: CostMetricsTracker | undefined;
  private readonly runtimeControls: RuntimeControls | undefined;

  constructor(
    metrics: MetricsRecorder,
    costTracker?: CostMetricsTracker,
    runtimeControls?: RuntimeControls,
  ) {
    this.metrics = metrics;
    this.costTracker = costTracker;
    this.runtimeControls = runtimeControls;
  }

  /**
   * Renders all metrics in Prometheus text exposition format.
   * Returns a single string suitable for serving at a /metrics endpoint.
   */
  export(): string {
    const lines: string[] = [];

    // HELP and TYPE lines for counters
    for (const [name, value] of Object.entries(this.metrics.snapshot().counters)) {
      lines.push(`# HELP ${sanitizeMetricName(name)} Counter metric`);
      lines.push(`# TYPE ${sanitizeMetricName(name)} counter`);
      lines.push(`${formatMetricName(sanitizeMetricName(name))} ${formatValue(value)}`);
      lines.push('');
    }

    // HELP and TYPE lines for timings (histogram)
    const timings = this.metrics.snapshot().timings;
    for (const [name, stats] of Object.entries(timings)) {
      const baseName = sanitizeMetricName(name);
      lines.push(`# HELP ${baseName} Timing metric`);
      lines.push(`# TYPE ${baseName} histogram`);
      lines.push(`${baseName}_count ${stats.count}`);
      lines.push(`${baseName}_sum ${formatValue(stats.avg * stats.count)}`);
      lines.push(`${baseName}_bucket{le="+Inf"} ${stats.count}`);
      lines.push(`${baseName}_bucket{le="50"} ${this._countLE(stats, 50)}`);
      lines.push(`${baseName}_bucket{le="100"} ${this._countLE(stats, 100)}`);
      lines.push(`${baseName}_bucket{le="250"} ${this._countLE(stats, 250)}`);
      lines.push(`${baseName}_bucket{le="500"} ${this._countLE(stats, 500)}`);
      lines.push(`${baseName}_bucket{le="1000"} ${this._countLE(stats, 1000)}`);
      lines.push(`${baseName}_bucket{le="+Inf"} ${stats.count}`);
      lines.push('');
    }

    // Cost metrics
    if (this.costTracker) {
      const costSnapshot = this.costTracker.snapshot();
      lines.push('# HELP rag_cost_total Total cost in USD');
      lines.push('# TYPE rag_cost_total counter');
      lines.push(`rag_cost_total ${formatValue(costSnapshot.totalCost)}`);
      lines.push('');

      lines.push('# HELP rag_cost_per_query Cost per query in USD');
      lines.push('# TYPE rag_cost_per_query gauge');
      lines.push(`rag_cost_per_query ${formatValue(costSnapshot.costPerQuery)}`);
      lines.push('');

      lines.push('# HELP rag_cost_per_ingestion Cost per ingestion in USD');
      lines.push('# TYPE rag_cost_per_ingestion gauge');
      lines.push(`rag_cost_per_ingestion ${formatValue(costSnapshot.costPerIngestion)}`);
      lines.push('');

      lines.push('# HELP rag_query_count Total number of queries');
      lines.push('# TYPE rag_query_count counter');
      lines.push(`rag_query_count ${costSnapshot.queryCount}`);
      lines.push('');

      lines.push('# HELP rag_ingestion_count Total number of ingestion operations');
      lines.push('# TYPE rag_ingestion_count counter');
      lines.push(`rag_ingestion_count ${costSnapshot.ingestionCount}`);
      lines.push('');

      lines.push('# HELP rag_total_token_count Total tokens processed');
      lines.push('# TYPE rag_total_token_count counter');
      lines.push(`rag_total_token_count ${costSnapshot.totalTokenCount}`);
      lines.push('');
    }

    // Runtime controls metrics
    if (this.runtimeControls) {
      const rcSnapshot = this.runtimeControls.snapshot();

      // Concurrency metrics
      lines.push('# HELP rag_concurrency_active Current number of concurrent operations');
      lines.push('# TYPE rag_concurrency_active gauge');
      lines.push(`rag_concurrency_active ${rcSnapshot.concurrency.active}`);
      lines.push('');

      lines.push('# HELP rag_concurrency_queued Current number of queued operations');
      lines.push('# TYPE rag_concurrency_queued gauge');
      lines.push(`rag_concurrency_queued ${rcSnapshot.concurrency.queued}`);
      lines.push('');

      lines.push('# HELP rag_concurrency_completed Total completed operations');
      lines.push('# TYPE rag_concurrency_completed counter');
      lines.push(`rag_concurrency_completed ${rcSnapshot.concurrency.completed}`);
      lines.push('');

      lines.push('# HELP rag_concurrency_rejected Total rejected operations');
      lines.push('# TYPE rag_concurrency_rejected counter');
      lines.push(`rag_concurrency_rejected ${rcSnapshot.concurrency.rejected}`);
      lines.push('');

      lines.push('# HELP rag_concurrency_timeouts Total concurrency timeouts');
      lines.push('# TYPE rag_concurrency_timeouts counter');
      lines.push(`rag_concurrency_timeouts ${rcSnapshot.concurrency.timeouts}`);
      lines.push('');

      // Circuit breaker metrics
      lines.push('# HELP rag_circuit_breaker_state Current circuit breaker state (0=closed, 1=open, 2=half-open)');
      lines.push('# TYPE rag_circuit_breaker_state gauge');
      const stateValue = this.circuitBreakerStateToNumber(rcSnapshot.circuitBreaker.state);
      lines.push(`rag_circuit_breaker_state ${stateValue}`);
      lines.push('');

      lines.push('# HELP rag_circuit_breaker_failures Total circuit breaker failures');
      lines.push('# TYPE rag_circuit_breaker_failures counter');
      lines.push(`rag_circuit_breaker_failures ${rcSnapshot.circuitBreaker.failures}`);
      lines.push('');

      lines.push('# HELP rag_circuit_breaker_trips Total circuit breaker trips');
      lines.push('# TYPE rag_circuit_breaker_trips counter');
      lines.push(`rag_circuit_breaker_trips ${rcSnapshot.circuitBreaker.trips}`);
      lines.push('');

      // Cache metrics
      lines.push('# HELP rag_cache_hits Total cache hits');
      lines.push('# TYPE rag_cache_hits counter');
      lines.push(`rag_cache_hits ${rcSnapshot.cache.hits}`);
      lines.push('');

      lines.push('# HELP rag_cache_misses Total cache misses');
      lines.push('# TYPE rag_cache_misses counter');
      lines.push(`rag_cache_misses ${rcSnapshot.cache.misses}`);
      lines.push('');

      lines.push('# HELP rag_cache_size Current cache size');
      lines.push('# TYPE rag_cache_size gauge');
      lines.push(`rag_cache_size ${rcSnapshot.cache.size}`);
      lines.push('');

      lines.push('# HELP rag_cache_max_size Maximum cache size');
      lines.push('# TYPE rag_cache_max_size gauge');
      lines.push(`rag_cache_max_size ${rcSnapshot.cache.maxSize}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  private _countLE(stats: { count: number; min: number; max: number; avg: number }, threshold: number): number {
    if (stats.count === 0) return 0;
    if (stats.min >= threshold) return stats.count;
    if (stats.max <= threshold) return stats.count;
    // Estimate: assume uniform distribution between min and max
    const proportion = Math.min(1, Math.max(0, (threshold - stats.min) / (stats.max - stats.min)));
    return Math.floor(stats.count * proportion);
  }

  private circuitBreakerStateToNumber(state: string): number {
    switch (state) {
      case 'closed':
        return 0;
      case 'open':
        return 1;
      case 'half-open':
        return 2;
      default:
        return -1;
    }
  }
}
