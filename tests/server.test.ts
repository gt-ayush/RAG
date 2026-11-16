import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as http from 'http';
import { createHttpServer, setupGracefulShutdown, MAX_REQUEST_BODY_SIZE } from '../src/server.js';
import type { ServerDependencies } from '../src/server.js';
import { RateLimiter } from '../src/runtime-controls.js';
import { createAuditLog } from '../src/audit.js';
import type { AuditEventType } from '../src/types.js';
import { makeAuthorizationPolicy } from '../src/authorization.js';
import type {
  Chunk,
  Embedding,
  ModelGeneration,
  RetrievalResult,
  TenantQuotaConfig,
} from '../src/types.js';
import type { LanguageModel } from '../src/generate.js';
import type { EmbeddingProvider } from '../src/embeddings.js';
import type { VectorStore } from '../src/vector-store.js';
import { createStructuredLogger, MetricsRecorder } from '../src/observability.js';

function makeChunk(id: string, docId: string, content: string): Chunk {
  return {
    id,
    documentId: docId,
    content,
    index: 0,
    metadata: {
      documentId: docId,
      source: `${docId}.txt`,
      chunkId: id,
      chunkIndex: 0,
    },
  };
}

function makeEmbedding(id: string, vector: number[]): Embedding {
  return {
    chunkId: id,
    model: 'test-embed',
    dimensions: vector.length,
    vector,
  };
}

function makeResult(chunk: Chunk, score: number, rank = 0): RetrievalResult {
  return { chunk, score, rank, sourceId: chunk.documentId };
}

function startTestServer(overrides: Partial<ServerDependencies> = {}): Promise<{ port: number; server: ReturnType<typeof import('http').createServer>; deps: ServerDependencies }> {
  const deps: ServerDependencies = {
    config: {
      llm: { apiKey: 'test-key', model: 'test-lm' },
      vectorDb: { url: 'http://localhost:6333' },
      embedding: { model: 'test-embed' },
    },
    embeddingProvider: {
      model: 'test-embed',
      dimensions: 2,
      embedTexts: vi.fn(async (texts) => texts.map((_, i) => makeEmbedding(`q:${i}`, [0.5, 0.5]))),
    } as EmbeddingProvider,
    vectorStore: {
      kind: 'test',
      dimensions: 2,
      query: vi.fn(async () => ({ ok: true, value: [] as RetrievalResult[] })),
    } as VectorStore,
    languageModel: {
      model: 'test-lm',
      generate: vi.fn(async () => ({ text: 'generated answer', insufficientContext: false })),
    } as LanguageModel,
    logger: createStructuredLogger(),
    metrics: new MetricsRecorder(),
    ...overrides,
  };

  const server = createHttpServer(deps);
  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      resolve({ port, server, deps });
    });
  });
}

function request(port: number, method: string, path: string, body?: unknown, rawBody?: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        method,
        path,
        headers: rawBody ? { 'Content-Type': 'application/json' } : body ? { 'Content-Type': 'application/json' } : {},
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          let parsed: unknown;
          try {
            parsed = data ? JSON.parse(data) : undefined;
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (rawBody) {
      req.write(rawBody);
    } else if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

describe('HTTP server boundary', () => {
  let servers: Array<ReturnType<typeof import('http').createServer>> = [];

  afterEach(() => {
    for (const server of servers) {
      server.close();
    }
    servers = [];
    vi.restoreAllMocks();
  });

  it('GET /health returns ok', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('GET /ready returns ready when deps wired', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'GET', '/ready');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ready' });
  });

  it('POST /query runs pipeline and returns answer', async () => {
    const chunk = makeChunk('c1', 'd1', 'remote work policy for employees');
    const result = makeResult(chunk, 0.9, 1);
    const { port, server, deps } = await startTestServer({
      vectorStore: {
        kind: 'test',
        dimensions: 2,
        query: vi.fn(async () => ({ ok: true, value: [result] })),
      } as VectorStore,
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'remote work policy', topK: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      answer: {
        text: 'generated answer',
        insufficientContext: false,
      },
      retrieved: [
        { chunkId: 'c1', sourceId: 'd1', score: 0.9, rank: 1 },
      ],
    });
    expect(deps.embeddingProvider.embedTexts).toHaveBeenCalledTimes(1);
  });

  it('POST /query returns insufficient context when no results', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'nothing matches' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      answer: {
        insufficientContext: true,
        citations: [],
      },
      retrieved: [],
    });
  });

  it('POST /query rejects missing query with 400', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'POST', '/query', { topK: 5 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_error' } });
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('POST /query rejects invalid topK with 400', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'test', topK: -1 });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: { code: 'validation_error' } });
  });

  it('POST /query rejects non-JSON body with 400', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'POST', '/query', undefined, 'not-json');
    expect(res.status).toBe(400);
    const parsed = res.body as { error: { code: string } };
    expect(parsed.error.code).toBe('bad_request');
  });

  it('unknown endpoint returns 404', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const res = await request(port, 'GET', '/unknown');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
  });

  it('GET /ready returns unavailable when deps missing', async () => {
    const server = createHttpServer({
      config: {
        llm: { apiKey: 'test-key', model: 'test-lm' },
        vectorDb: { url: 'http://localhost:6333' },
        embedding: { model: 'test-embed' },
      },
      embeddingProvider: undefined as unknown as EmbeddingProvider,
      vectorStore: undefined as unknown as VectorStore,
      languageModel: undefined as unknown as LanguageModel,
      logger: createStructuredLogger(),
      metrics: new MetricsRecorder(),
    });
    servers.push(server);

    return new Promise((resolve) => {
      server.listen(0, () => {
        const port = (server.address() as { port: number }).port;
        request(port, 'GET', '/ready').then((res) => {
          expect(res.status).toBe(503);
          expect(res.body).toEqual({ status: 'unavailable' });
          resolve(undefined);
        });
      });
    });
  });

  it('POST /query with authorization policy and valid principal returns 200', async () => {
    const chunk = makeChunk('c1', 'd1', 'remote work policy for employees');
    const result = makeResult(chunk, 0.9, 1);
    const { port, server } = await startTestServer({
      vectorStore: {
        kind: 'test',
        dimensions: 2,
        query: vi.fn(async () => ({ ok: true, value: [result] })),
      } as VectorStore,
      authorizationPolicy: makeAuthorizationPolicy({
        tenantId: 'tenant-a',
        allowedDocumentIds: ['d1'],
      }),
      authorizationPrincipal: { tenantId: 'tenant-a', allowedDocumentIds: ['d1'] },
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'remote work policy', topK: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      answer: {
        insufficientContext: false,
      },
    });
  });

  it('POST /query with cross-tenant principal returns 403', async () => {
    const { port, server } = await startTestServer({
      authorizationPolicy: makeAuthorizationPolicy({
        tenantId: 'tenant-a',
      }),
      authorizationPrincipal: { tenantId: 'tenant-b' },
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('POST /query with no principal returns 401 when policy configured', async () => {
    const { port, server } = await startTestServer({
      authorizationPolicy: makeAuthorizationPolicy({
        tenantId: 'tenant-a',
      }),
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('POST /query with oversized body returns 413', async () => {
    const { port, server } = await startTestServer();
    servers.push(server);

    const oversized = 'x'.repeat(Number(MAX_REQUEST_BODY_SIZE) + 1);
    const res = await request(port, 'POST', '/query', undefined, JSON.stringify({ query: oversized }));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('setupGracefulShutdown stop() closes the server', async () => {
    const deps: ServerDependencies = {
      config: {
        llm: { apiKey: 'test-key', model: 'test-lm' },
        vectorDb: { url: 'http://localhost:6333' },
        embedding: { model: 'test-embed' },
      },
      embeddingProvider: undefined as unknown as EmbeddingProvider,
      vectorStore: undefined as unknown as VectorStore,
      languageModel: undefined as unknown as LanguageModel,
      logger: createStructuredLogger(),
      metrics: new MetricsRecorder(),
    };

    const server = createHttpServer(deps);
    await new Promise((resolve) => server.listen(0, resolve));
    const { stop, signal } = setupGracefulShutdown(server, { timeoutMs: 1000 });
    expect(signal.aborted).toBe(false);

    await stop();
    expect(signal.aborted).toBe(true);

    // Server should no longer accept connections.
    await new Promise<void>((resolve, reject) => {
      server.close(() => resolve());
      server.on('error', reject);
    });
  });

  it('setupGracefulShutdown is idempotent', async () => {
    const deps: ServerDependencies = {
      config: {
        llm: { apiKey: 'test-key', model: 'test-lm' },
        vectorDb: { url: 'http://localhost:6333' },
        embedding: { model: 'test-embed' },
      },
      embeddingProvider: undefined as unknown as EmbeddingProvider,
      vectorStore: undefined as unknown as VectorStore,
      languageModel: undefined as unknown as LanguageModel,
      logger: createStructuredLogger(),
      metrics: new MetricsRecorder(),
    };

    const server = createHttpServer(deps);
    await new Promise((resolve) => server.listen(0, resolve));
    const { stop } = setupGracefulShutdown(server, { timeoutMs: 1000 });

    await stop();
    await stop(); // second call should not throw
  });

  it('POST /query returns 429 when tenant rate limit is exceeded', async () => {
    const rateLimiter = new RateLimiter({ maxRequests: 2, windowMs: 60000 });
    const { port, server } = await startTestServer({
      rateLimiter,
      authorizationPrincipal: { tenantId: 'tenant-a' },
    });
    servers.push(server);

    // First two requests allowed.
    for (let i = 0; i < 2; i += 1) {
      const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
      expect(res.status).not.toBe(429);
    }

    // Third request rate-limited.
    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('POST /query returns 429 when tenant quota is exceeded', async () => {
    const tenantQuotas = new Map<string, TenantQuotaConfig>([
      ['tenant-a', { maxRequestsPerWindow: 2, windowMs: 60000 }],
    ]);
    const { port, server } = await startTestServer({
      tenantQuotas,
      authorizationPrincipal: { tenantId: 'tenant-a' },
    });
    servers.push(server);

    // First two requests allowed.
    for (let i = 0; i < 2; i += 1) {
      const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
      expect(res.status).not.toBe(429);
    }

    // Third request quota-limited.
    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: { code: 'rate_limited' } });
  });

  it('POST /query returns 403 when principal lacks required role', async () => {
    const { port, server } = await startTestServer({
      requiredRoles: ['admin'],
      authorizationPrincipal: { tenantId: 'tenant-a', roles: ['user'] },
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'forbidden' } });
  });

  it('POST /query allows request when principal has required role', async () => {
    const { port, server } = await startTestServer({
      requiredRoles: ['admin'],
      authorizationPrincipal: { tenantId: 'tenant-a', roles: ['admin'] },
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a' }),
    });
    servers.push(server);

    const res = await request(port, 'POST', '/query', { query: 'test', topK: 5 });
    expect(res.status).toBe(200);
  });

  it('POST /query emits query.received audit event', async () => {
    const auditLog = createAuditLog();
    const { port, server } = await startTestServer({
      auditLog,
      authorizationPrincipal: { tenantId: 'tenant-a' },
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a' }),
    });
    servers.push(server);

    await request(port, 'POST', '/query', { query: 'remote work policy', topK: 5 });

    const events = await auditLog.read();
    const received = events.filter((e) => e.type === 'query.received');
    expect(received).toHaveLength(1);
    expect(received[0].payload.query).toBe('remote work policy');
    expect(received[0].payload.topK).toBe(5);
  });

  it('POST /query emits query.authorization_denied audit event for missing principal', async () => {
    const auditLog = createAuditLog();
    const { port, server } = await startTestServer({
      auditLog,
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a' }),
    });
    servers.push(server);

    await request(port, 'POST', '/query', { query: 'test', topK: 5 });

    const events = await auditLog.read();
    const denied = events.filter((e) => e.type === 'query.authorization_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].payload.reason).toBe('missing trusted principal');
  });

  it('POST /query emits query.authorization_denied audit event for denied policy', async () => {
    const auditLog = createAuditLog();
    const { port, server } = await startTestServer({
      auditLog,
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a' }),
      authorizationPrincipal: { tenantId: 'tenant-b' },
    });
    servers.push(server);

    await request(port, 'POST', '/query', { query: 'test', topK: 5 });

    const events = await auditLog.read();
    const denied = events.filter((e) => e.type === 'query.authorization_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].payload.reason).toBe('tenant access denied');
  });

  it('POST /query emits query.retrieved and generation events on success', async () => {
    const auditLog = createAuditLog();
    const chunk = {
      id: 'c1',
      documentId: 'd1',
      content: 'remote work policy for employees',
      index: 0,
      metadata: {
        documentId: 'd1',
        source: 'd1.txt',
        chunkId: 'c1',
        chunkIndex: 0,
      },
    } as any;
    const result = { chunk, score: 0.9, rank: 1, sourceId: 'd1' };
    const { port, server } = await startTestServer({
      auditLog,
      authorizationPrincipal: { tenantId: 'tenant-a' },
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a', allowedDocumentIds: ['d1'] }),
      vectorStore: {
        kind: 'test',
        dimensions: 2,
        query: async () => ({ ok: true, value: [result] }),
      } as any,
    });
    servers.push(server);

    await request(port, 'POST', '/query', { query: 'remote work policy', topK: 5 });

    const events = await auditLog.read();
    const types = events.map((e) => e.type);
    expect(types).toContain('query.received');
    expect(types).toContain('query.retrieved');
    expect(types).toContain('generation.started');
    expect(types).toContain('generation.completed');

    const retrievedEvent = events.find((e) => e.type === 'query.retrieved')!;
    expect(retrievedEvent.payload.candidateIds).toEqual(['c1']);
    expect(retrievedEvent.payload.sourceIds).toEqual(['d1']);

    const completedEvent = events.find((e) => e.type === 'generation.completed')!;
    expect(completedEvent.payload.citationsCount).toBeGreaterThanOrEqual(0);
  });

  it('POST /query emits generation.insufficient_context when no results', async () => {
    const auditLog = createAuditLog();
    const { port, server } = await startTestServer({
      auditLog,
      authorizationPrincipal: { tenantId: 'tenant-a' },
      authorizationPolicy: makeAuthorizationPolicy({ tenantId: 'tenant-a' }),
      vectorStore: {
        kind: 'test',
        dimensions: 2,
        query: async () => ({ ok: true, value: [] }),
      } as any,
    });
    servers.push(server);

    await request(port, 'POST', '/query', { query: 'nothing matches', topK: 5 });

    const events = await auditLog.read();
    const types = events.map((e) => e.type);
    expect(types).toContain('query.received');
    expect(types).toContain('query.retrieved');
    expect(types).toContain('generation.insufficient_context');
    expect(types).not.toContain('generation.started');
    expect(types).not.toContain('generation.completed');
  });
});
