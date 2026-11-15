import type { EmbeddingProvider } from './embeddings.js';
import type { LanguageModel } from './generate.js';
import type { PipelineConfig, Result } from './types.js';
import type { VectorStore } from './vector-store.js';
import type { AuthorizationContext, AuthorizationEvaluator, RetrievalReranker, RetrieveRequest } from './retrieve.js';
import { retrieve } from './retrieve.js';
import { generateGroundedAnswer } from './generate.js';
import { createStructuredLogger, type Logger, MetricsRecorder } from './observability.js';
import * as http from 'http';

/**
 * Source-of-truth keywords: HTTP server, API boundary, health, readiness,
 * structured errors
 */

export interface ServerDependencies {
  config: PipelineConfig;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  languageModel: LanguageModel;
  reranker?: RetrievalReranker;
  authorization?: { context: AuthorizationContext; evaluate?: AuthorizationEvaluator };
  logger: Logger;
  metrics: MetricsRecorder;
}

export interface QueryRequestBody {
  query: string;
  topK?: number;
  tenantId?: string;
}

export interface QueryResponseBody {
  answer: {
    text: string;
    citations: readonly { sourceId: string; chunkId: string; source: string; page?: number; section?: string }[];
    insufficientContext: boolean;
  };
  retrieved: readonly { chunkId: string; sourceId: string; score: number; rank: number }[];
}

export interface ErrorResponseBody {
  error: {
    code: string;
    message: string;
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function parseJsonBody<T>(raw: string): Result<T> {
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return {
      ok: false,
      issues: [{ path: 'body', message: 'must be valid JSON' }],
    };
  }
}

function validateQueryBody(body: unknown): Result<QueryRequestBody> {
  const issues: { path: string; message: string }[] = [];

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      ok: false,
      issues: [{ path: 'body', message: 'must be a JSON object' }],
    };
  }

  const b = body as Record<string, unknown>;
  if (!isNonEmptyString(b.query)) {
    issues.push({ path: 'query', message: 'is required and must be a non-empty string' });
  }

  const topK = b.topK;
  if (topK !== undefined && !isPositiveInteger(topK)) {
    issues.push({ path: 'topK', message: 'must be a positive integer' });
  }

  const tenantId = b.tenantId;
  if (tenantId !== undefined && !isNonEmptyString(tenantId)) {
    issues.push({ path: 'tenantId', message: 'must be a non-empty string' });
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const value: QueryRequestBody = { query: b.query as string };
  if (topK !== undefined) {
    value.topK = topK as number;
  }
  if (tenantId !== undefined) {
    value.tenantId = tenantId as string;
  }
  return { ok: true, value };
}

function statusCodeFor(code: string): number {
  if (code === 'validation_error' || code === 'bad_request') return 400;
  if (code === 'unauthorized') return 401;
  if (code === 'forbidden') return 403;
  if (code === 'not_found') return 404;
  if (code === 'unavailable' || code === 'timeout') return 503;
  return 500;
}

function errorResponse(code: string, message: string): ErrorResponseBody {
  return { error: { code, message } };
}

function buildAuthz(deps: ServerDependencies): { context: AuthorizationContext; evaluate?: AuthorizationEvaluator } | undefined {
  if (!deps.authorization) return undefined;
  return {
    context: deps.authorization.context,
    ...(deps.authorization.evaluate ? { evaluate: deps.authorization.evaluate } : {}),
  };
}

/**
 * Creates a minimal HTTP service boundary for the RAG pipeline.
 *
 * Endpoints:
 *   GET  /health      -> 200 { status: 'ok' }
 *   GET  /ready       -> 200 { status: 'ready' } when pipeline deps are wired
 *   POST  /query      -> validate body, run retrieve + generate, return answer
 *
 * All responses are JSON. Errors are structured and never leak secrets or
 * provider internals. Request validation happens before any pipeline call.
 */
export function createHttpServer(deps: ServerDependencies): http.Server {
  const { config, embeddingProvider, vectorStore, languageModel, logger, metrics } = deps;
  const authz = buildAuthz(deps);

  const server = http.createServer(async (req, res) => {
    const startMs = Date.now();
    let statusCode = 200;

    const sendJson = (code: number, body: unknown) => {
      const payload = JSON.stringify(body);
      res.writeHead(code, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload).toString(),
      });
      res.end(payload);
    };

    const sendError = (code: string, message: string, httpStatus: number) => {
      statusCode = httpStatus;
      metrics.increment(`http_${httpStatus}`);
      logger.warn('http_error', { path: req.url, code, status: httpStatus });
      sendJson(httpStatus, errorResponse(code, message));
    };

    try {
      if (req.method === 'GET' && req.url === '/health') {
        metrics.increment('http_health');
        sendJson(200, { status: 'ok' });
        return;
      }

      if (req.method === 'GET' && req.url === '/ready') {
        const ready = !!embeddingProvider && !!vectorStore && !!languageModel;
        metrics.increment('http_ready');
        sendJson(ready ? 200 : 503, { status: ready ? 'ready' : 'unavailable' });
        return;
      }

      if (req.method === 'POST' && req.url === '/query') {
        let raw = '';
        for await (const chunk of req) {
          raw += chunk as string;
        }

        const parsed = parseJsonBody<QueryRequestBody>(raw);
        if (!parsed.ok) {
          sendError('bad_request', 'invalid request body', 400);
          return;
        }

        const validated = validateQueryBody(parsed.value);
        if (!validated.ok) {
          sendError('validation_error', validated.issues.map((i) => `${i.path}: ${i.message}`).join('; '), 400);
          return;
        }

        const { query } = validated.value;
        const tenantId = validated.value.tenantId;

        const retrieveRequest: RetrieveRequest = {
          text: query,
          topK: validated.value.topK ?? 5,
        };
        if (tenantId !== undefined) {
          retrieveRequest.tenantId = tenantId;
        }

        const retrieved = await retrieve(
          retrieveRequest,
          {
            embeddingProvider,
            vectorStore,
            ...(deps.reranker ? { reranker: deps.reranker } : {}),
          },
          authz,
        );

        if (!retrieved.ok) {
          sendError('retrieval_error', retrieved.issues.map((i) => `${i.path}: ${i.message}`).join('; '), 502);
          return;
        }

        let answer;
        if (retrieved.value.length === 0) {
          answer = {
            text: `Insufficient retrieved evidence to answer: "${query}".`,
            citations: [],
            insufficientContext: true,
          };
        } else {
          const generated = await generateGroundedAnswer(
            { query, context: retrieved.value },
            {
              model: languageModel,
              ...(config.llm ? { expectedModel: config.llm.model } : {}),
              ...(config.llm?.timeoutMs ? { timeoutMs: config.llm.timeoutMs } : {}),
            },
          );

          if (!generated.ok) {
            sendError('generation_error', generated.issues.map((i) => `${i.path}: ${i.message}`).join('; '), 502);
            return;
          }

          answer = {
            text: generated.value.text,
            citations: generated.value.citations.map((c) => ({
              sourceId: c.sourceId,
              chunkId: c.chunkId,
              source: c.source,
              ...(c.page !== undefined ? { page: c.page } : {}),
              ...(c.section !== undefined ? { section: c.section } : {}),
            })),
            insufficientContext: generated.value.insufficientContext,
          };
        }

        metrics.increment('http_query');
        statusCode = 200;
        sendJson(200, {
          answer,
          retrieved: retrieved.value.map((r) => ({
            chunkId: r.chunk.id,
            sourceId: r.sourceId,
            score: r.score,
            rank: r.rank,
          })),
        });
        return;
      }

      sendError('not_found', `unknown endpoint ${req.method} ${req.url}`, 404);
    } catch (error) {
      statusCode = 500;
      metrics.increment('http_500');
      logger.error('http_internal_error', { path: req.url, error: String(error) });
      sendJson(500, errorResponse('internal_error', 'an internal error occurred'));
    } finally {
      const durationMs = Date.now() - startMs;
      metrics.timing('http_request_duration_ms', durationMs);
      logger.info('http_request', {
        method: req.method,
        path: req.url,
        status: statusCode,
        durationMs,
      });
    }
  });

  return server;
}
