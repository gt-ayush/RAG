import { describe, expect, it } from 'vitest';
import {
  evaluateSlos,
  buildBurnInResult,
  printBurnInReport,
  allSlosPassed,
} from '../src/slo.js';
import { runBurnIn } from '../src/burn-in.js';
import type {
  BurnInConfig,
  BurnInQueryResult,
  BurnInResult,
  SloResult,
} from '../src/types.js';
import * as http from 'http';

function makeBurnInConfig(overrides: Partial<BurnInConfig> = {}): BurnInConfig {
  return {
    durationMs: 60000,
    targetQps: 10,
    targetLatencyP95Ms: 800,
    targetAvailability: 0.999,
    maxErrorRate: 0.01,
    targetRecallAtK: 0.85,
    recallK: 10,
    requireZeroSecurityFindings: true,
    requireZeroAuditLogLoss: true,
    ...overrides,
  };
}

function makeQueryResult(overrides: Partial<BurnInQueryResult> = {}): BurnInQueryResult {
  return {
    success: true,
    latencyMs: 50,
    statusCode: 200,
    recallAtK: 0.9,
    auditLogged: true,
    ...overrides,
  };
}

describe('evaluateSlos', () => {
  it('passes all SLOs when metrics are within targets', () => {
    const config = makeBurnInConfig();
    const results: BurnInQueryResult[] = Array.from({ length: 100 }, () =>
      makeQueryResult({ success: true, latencyMs: 50, recallAtK: 0.9, auditLogged: true }),
    );

    const slos = evaluateSlos(config, results);

    expect(slos.some((s) => !s.passed)).toBe(false);
    const availability = slos.find((s) => s.type === 'availability');
    expect(availability?.passed).toBe(true);
    expect(availability?.value).toBe(1.0);

    const latency = slos.find((s) => s.type === 'latency_p95');
    expect(latency?.passed).toBe(true);
    expect(latency?.value).toBe(50);

    const recall = slos.find((s) => s.type === 'recall_at_k');
    expect(recall?.passed).toBe(true);
    expect(recall?.value).toBeCloseTo(0.9);
  });

  it('fails availability SLO when too many queries fail', () => {
    const config = makeBurnInConfig();
    const results: BurnInQueryResult[] = Array.from({ length: 100 }, (_, i) =>
      makeQueryResult({
        success: i < 990, // 10 failures out of 1000 = 1% error rate = 99% availability
        latencyMs: 50,
        recallAtK: 0.9,
        auditLogged: true,
      }),
    ).slice(0, 100);

    // Actually with 100 queries and 10 failures, availability = 90%
    const fewResults: BurnInQueryResult[] = Array.from({ length: 100 }, (_, i) =>
      makeQueryResult({
        success: i < 90,
        latencyMs: 50,
        recallAtK: 0.9,
        auditLogged: true,
      }),
    );

    const slos = evaluateSlos(config, fewResults);
    const availability = slos.find((s) => s.type === 'availability');
    expect(availability?.passed).toBe(false);
    expect(availability?.value).toBe(0.9);
  });

  it('fails latency P95 SLO when p95 exceeds target', () => {
    const config = makeBurnInConfig({ targetLatencyP95Ms: 100 });
    const results: BurnInQueryResult[] = Array.from({ length: 100 }, () =>
      makeQueryResult({ success: true, latencyMs: 200, recallAtK: 0.9, auditLogged: true }),
    );

    const slos = evaluateSlos(config, results);
    const latency = slos.find((s) => s.type === 'latency_p95');
    expect(latency?.passed).toBe(false);
    expect(latency?.value).toBe(200);
  });

  it('fails recall SLO when recall is below target', () => {
    const config = makeBurnInConfig({ targetRecallAtK: 0.95 });
    const results: BurnInQueryResult[] = Array.from({ length: 100 }, () =>
      makeQueryResult({ success: true, latencyMs: 50, recallAtK: 0.8, auditLogged: true }),
    );

    const slos = evaluateSlos(config, results);
    const recall = slos.find((s) => s.type === 'recall_at_k');
    expect(recall?.passed).toBe(false);
    expect(recall?.value).toBeCloseTo(0.8);
  });

  it('fails error rate SLO when error rate exceeds target', () => {
    const config = makeBurnInConfig({ maxErrorRate: 0.01 });
    const results: BurnInQueryResult[] = Array.from({ length: 100 }, (_, i) =>
      makeQueryResult({ success: i < 95, latencyMs: 50, recallAtK: 0.9, auditLogged: true }),
    );

    const slos = evaluateSlos(config, results);
    const errorRate = slos.find((s) => s.type === 'error_rate');
    expect(errorRate?.passed).toBe(false);
    expect(errorRate?.value).toBe(0.05);
  });

  it('handles empty results gracefully', () => {
    const config = makeBurnInConfig();
    const slos = evaluateSlos(config, []);

    expect(slos.length).toBeGreaterThan(0);
    const availability = slos.find((s) => s.type === 'availability');
    expect(availability?.value).toBe(0);
    expect(availability?.passed).toBe(false);
  });
});

describe('buildBurnInResult', () => {
  it('builds a complete burn-in result', () => {
    const config = makeBurnInConfig();
    const results: BurnInQueryResult[] = Array.from({ length: 10 }, () =>
      makeQueryResult({ success: true, latencyMs: 50, recallAtK: 0.9, auditLogged: true }),
    );

    const result = buildBurnInResult(
      config,
      '2026-01-01T00:00:00Z',
      '2026-01-01T01:00:00Z',
      results,
      0,
    );

    expect(result.totalQueries).toBe(10);
    expect(result.successfulQueries).toBe(10);
    expect(result.failedQueries).toBe(0);
    expect(result.allSlosPassed).toBe(true);
    expect(result.config).toBe(config);
    expect(result.startedAt).toBe('2026-01-01T00:00:00Z');
    expect(result.endedAt).toBe('2026-01-01T01:00:00Z');
  });

  it('detects failed SLOs', () => {
    const config = makeBurnInConfig({ targetLatencyP95Ms: 10 });
    const results: BurnInQueryResult[] = Array.from({ length: 10 }, () =>
      makeQueryResult({ success: true, latencyMs: 500, recallAtK: 0.9, auditLogged: true }),
    );

    const result = buildBurnInResult(
      config,
      '2026-01-01T00:00:00Z',
      '2026-01-01T01:00:00Z',
      results,
      0,
    );

    expect(result.allSlosPassed).toBe(false);
    const latencySlo = result.sloResults.find((s) => s.type === 'latency_p95');
    expect(latencySlo?.passed).toBe(false);
  });
});

describe('allSlosPassed', () => {
  it('returns true when all SLOs pass', () => {
    const slos: SloResult[] = [
      { type: 'availability', passed: true, value: 0.999, target: 0.999, lowerIsBetter: false, description: 'test' },
      { type: 'latency_p95', passed: true, value: 50, target: 800, lowerIsBetter: true, description: 'test' },
    ];
    expect(allSlosPassed(slos)).toBe(true);
  });

  it('returns false when any SLO fails', () => {
    const slos: SloResult[] = [
      { type: 'availability', passed: true, value: 0.999, target: 0.999, lowerIsBetter: false, description: 'test' },
      { type: 'latency_p95', passed: false, value: 900, target: 800, lowerIsBetter: true, description: 'test' },
    ];
    expect(allSlosPassed(slos)).toBe(false);
  });
});

describe('runBurnIn', () => {
  it('runs burn-in against a local HTTP server', async () => {
    const config = makeBurnInConfig({
      durationMs: 100, // Very short burn-in
      targetQps: 100,
    });

    // Create a simple test server
    const server = http.createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/query') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            answer: { text: 'test answer', citations: [{ sourceId: 'doc1' }] },
            retrieved: [{ chunkId: 'c1', sourceId: 'doc1', score: 0.9, rank: 1 }],
          }),
        );
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const result = await runBurnIn({
        baseUrl: `http://127.0.0.1:${port}`,
        config,
        queries: ['test query 1', 'test query 2'],
        tenantId: 'tenant-a',
      });

      expect(result.totalQueries).toBeGreaterThan(0);
      expect(result.successfulQueries).toBe(result.totalQueries);
      expect(result.allSlosPassed).toBe(true);
    } finally {
      server.close();
    }
  }, 10000);

  it('handles server errors during burn-in', async () => {
    const config = makeBurnInConfig({
      durationMs: 100,
      targetQps: 100,
    });

    const server = http.createServer((req, res) => {
      res.writeHead(500);
      res.end('Internal error');
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    try {
      const result = await runBurnIn({
        baseUrl: `http://127.0.0.1:${port}`,
        config,
        queries: ['test query'],
      });

      expect(result.failedQueries).toBe(result.totalQueries);
      expect(result.allSlosPassed).toBe(false);
    } finally {
      server.close();
    }
  }, 10000);
});

describe('printBurnInReport', () => {
  it('prints a report without throwing', () => {
    const config = makeBurnInConfig();
    const results: BurnInQueryResult[] = Array.from({ length: 10 }, () =>
      makeQueryResult({ success: true, latencyMs: 50, recallAtK: 0.9, auditLogged: true }),
    );

    const result = buildBurnInResult(
      config,
      '2026-01-01T00:00:00Z',
      '2026-01-01T01:00:00Z',
      results,
      0,
    );

    expect(() => printBurnInReport(result)).not.toThrow();
  });
});
