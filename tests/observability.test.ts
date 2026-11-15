import { describe, expect, it, vi } from 'vitest';
import { createStructuredLogger, MetricsRecorder, sanitizeLogData } from '../src/observability.js';

describe('observability', () => {
  it('sanitizes sensitive fields and large values in structured logs', () => {
    const sink = vi.fn();
    const logger = createStructuredLogger(sink);

    logger.info('request.completed', {
      apiKey: 'sk-secret',
      authorization: 'Bearer token',
      prompt: 'user private prompt',
      evidence: 'retrieved content',
      document: 'full text',
      status: 200,
      route: '/query',
      detail: 'x'.repeat(300),
      items: [1, 2, 3],
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const event = sink.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(event.data.apiKey).toBe('[REDACTED]');
    expect(event.data.authorization).toBe('[REDACTED]');
    expect(event.data.prompt).toBe('[REDACTED]');
    expect(event.data.evidence).toBe('[REDACTED]');
    expect(event.data.document).toBe('[REDACTED]');
    expect(event.data.status).toBe(200);
    expect(event.data.route).toBe('/query');
    expect(String(event.data.detail).endsWith('…')).toBe(true);
    expect(event.data.items).toBe('[array:3]');
    expect(JSON.stringify(event)).not.toContain('sk-secret');
  });

  it('records counters and timing summaries', () => {
    const metrics = new MetricsRecorder();
    metrics.increment('requests.total');
    metrics.increment('requests.failed', 2);
    metrics.timing('retrieval.ms', 10);
    metrics.timing('retrieval.ms', 30);

    expect(metrics.snapshot()).toEqual({
      counters: { 'requests.total': 1, 'requests.failed': 2 },
      timings: { 'retrieval.ms': { count: 2, min: 10, max: 30, avg: 20 } },
    });
  });

  it('sanitizeLogData redacts sensitive keys case-insensitively', () => {
    const out = sanitizeLogData({ LLM_API_KEY: 'secret', nested: { ok: true } });
    expect(out.LLM_API_KEY).toBe('[REDACTED]');
    expect(out.nested).toBe('[object]');
  });
});
