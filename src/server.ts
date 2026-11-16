import type { EmbeddingProvider } from './embeddings.js';
import type { LanguageModel } from './generate.js';
import type {
  AuthorizationDecision,
  AuthorizationPolicy,
  AuthorizationPrincipal,
  AuditEventType,
  AuditLog,
  PipelineConfig,
  Result,
  TenantAuthorizationPolicyConfig,
  TenantQuotaConfig,
  TenantQuotaCheckResult,
} from './types.js';
import type { VectorStore } from './vector-store.js';
import type {
  AuthorizationContext,
  AuthorizationEvaluator,
  RetrievalReranker,
  RetrieveRequest,
} from './retrieve.js';
import { retrieve } from './retrieve.js';
import { generateGroundedAnswer } from './generate.js';
import { decisionToAuthzComponents, makeAuthorizationPolicy } from './authorization.js';
import { createStructuredLogger, type Logger, MetricsRecorder } from './observability.js';
import { RateLimiter as GatewayRateLimiter } from './runtime-controls.js';
import * as http from 'http';

/**
 * Source-of-truth keywords: HTTP server, API boundary, health, readiness,
 * structured errors, authorization, tenant isolation
 */

export interface ServerDependencies {
  config: PipelineConfig;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  languageModel: LanguageModel;
  reranker?: RetrievalReranker;
  /** Optional authorization policy evaluated server-side before retrieval. */
  authorizationPolicy?: AuthorizationPolicy;
  /** Optional trusted principal resolved from request context (e.g. JWT). */
  authorizationPrincipal?: AuthorizationPrincipal;
  /** Optional tenant config for building a default authorization policy. */
  authorizationTenantConfig?: TenantAuthorizationPolicyConfig;
  /** Optional per-tenant rate limiter for gateway-level throttling. */
  rateLimiter?: GatewayRateLimiter;
  /** Optional per-tenant quota configs keyed by tenantId. */
  tenantQuotas?: Map<string, TenantQuotaConfig>;
  /** Optional roles required to access the query endpoint (RBAC). */
  requiredRoles?: readonly string[];
  /** Optional append-only audit log for query/retrieval/generation events. */
  auditLog?: AuditLog;
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

/** Maximum request body size in bytes allowed for /query. */
export const MAX_REQUEST_BODY_SIZE = 1_024 * 1_024; // 1 MiB

/**
 * Options for graceful shutdown of an HTTP server.
 */
export interface GracefulShutdownOptions {
  /** Maximum time in ms to wait for in-flight requests to drain before forcing close. */
  timeoutMs?: number;
  /** Signals that trigger shutdown (default: SIGTERM, SIGINT). */
  signals?: readonly NodeJS.Signals[];
  /** Optional callback invoked after the server has closed. */
  onStop?: () => void;
}

/**
 * Result of setting up graceful shutdown.
 */
export interface GracefulShutdownHandle {
  /** Programmatically trigger shutdown; resolves once the server has closed. */
  stop: () => Promise<void>;
  /** The abort signal that becomes aborted once shutdown is requested. */
  signal: AbortSignal;
}

/**
 * Registers signal handlers (SIGTERM/SIGINT by default) on *server* so that
 * receiving a termination signal stops accepting new connections, drains
 * in-flight requests up to *timeoutMs*, then closes the server.
 *
 * Returns a handle with a programmatic `stop()` and an AbortSignal that pipeline
 * code can observe to cancel in-flight work. Safe to call multiple times; only
 * the first invocation proceeds.
 *
 * @example
 * const server = createHttpServer(deps);
 * const { stop, signal } = setupGracefulShutdown(server, { timeoutMs: 5000 });
 * server.listen(port);
 * // pipeline work can listen to `signal` to stop accepting new tasks.
 */
export function setupGracefulShutdown(
  server: http.Server,
  options: GracefulShutdownOptions = {},
): GracefulShutdownHandle {
  const { timeoutMs = 5000, signals = ['SIGTERM', 'SIGINT'], onStop } = options;

  const controller = new AbortController();
  let settled = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const stop = async (): Promise<void> => {
    if (settled) return;
    settled = true;
    controller.abort();

    // Stop accepting new connections.
    server.close(() => {
      if (onStop) onStop();
    });

    // Force-close after the drain timeout.
    if (timeoutMs > 0) {
      closeTimer = setTimeout(() => {
        server.close();
        if (closeTimer) clearTimeout(closeTimer);
      }, timeoutMs);
    }
  };

  const handleSignal = async (signal: NodeJS.Signals) => {
    await stop();
  };

  for (const signal of signals) {
    try {
      process.on(signal, handleSignal);
    } catch {
      // Signal not supported on this platform; ignore.
    }
  }

  return { stop, signal: controller.signal };
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
  if (code === 'rate_limited') return 429;
  if (code === 'unavailable' || code === 'timeout') return 503;
  return 500;
}

/**
 * Resolves the tenant identity for a request. The trusted authorization
 * principal (resolved server-side, e.g. from a JWT) is authoritative. Falls
 * back to the X-Tenant-Id header, then the request body tenantId (best effort;
 * never trusted for authorization, only for rate-limit keying).
 */
function resolveTenantId(
  req: http.IncomingMessage,
  body: QueryRequestBody | undefined,
  deps: ServerDependencies,
): string | undefined {
  if (deps.authorizationPrincipal?.tenantId) {
    return deps.authorizationPrincipal.tenantId;
  }
  const header = req.headers['x-tenant-id'];
  if (typeof header === 'string' && header.trim().length > 0) {
    return header.trim();
  }
  if (body?.tenantId) {
    return body.tenantId;
  }
  return undefined;
}

/**
 * Checks per-tenant quota (request rate + optional token budget).
 * Fail-closed: on missing config or over-quota, returns allowed=false.
 */
function checkTenantQuota(
  tenantId: string | undefined,
  deps: ServerDependencies,
): TenantQuotaCheckResult {
  if (!tenantId || !deps.tenantQuotas) {
    return { allowed: true };
  }

  const config = deps.tenantQuotas.get(tenantId);
  if (!config) {
    // No quota configured for this tenant: allow by default.
    return { allowed: true };
  }

  const now = Date.now();
  // Simple in-memory per-tenant window tracked on the rate limiter's windows
  // map is not exposed here; track quota state lazily via a module-level map.
  const quotaState = tenantQuotaWindows.get(tenantId) ?? {
    requests: 0,
    tokens: 0,
    resetAt: now + config.windowMs,
  };

  if (now >= quotaState.resetAt) {
    quotaState.requests = 0;
    quotaState.tokens = 0;
    quotaState.resetAt = now + config.windowMs;
  }

  quotaState.requests += 1;
  tenantQuotaWindows.set(tenantId, quotaState);

  if (quotaState.requests > config.maxRequestsPerWindow) {
    return {
      allowed: false,
      reason: 'tenant request quota exceeded',
      remainingRequests: 0,
    };
  }

  return {
    allowed: true,
    remainingRequests: config.maxRequestsPerWindow - quotaState.requests,
  };
}

/** Per-tenant quota window state (in-memory, single instance). */
const tenantQuotaWindows = new Map<string, {
  requests: number;
  tokens: number;
  resetAt: number;
}>();

/**
 * Checks RBAC role requirements. Fail-closed: when requiredRoles is set and
 * the principal lacks any required role, returns allowed=false.
 */
function checkRequiredRoles(
  deps: ServerDependencies,
): { allowed: boolean; reason?: string } {
  if (!deps.requiredRoles || deps.requiredRoles.length === 0) {
    return { allowed: true };
  }
  const principalRoles = new Set(deps.authorizationPrincipal?.roles ?? []);
  for (const role of deps.requiredRoles) {
    if (!principalRoles.has(role)) {
      return { allowed: false, reason: `missing required role: ${role}` };
    }
  }
  return { allowed: true };
}

/**
 * Safely appends an audit event. Failures are logged but never fail the
 * request — audit is best-effort observability, not a hard gate.
 */
async function emitAudit(
  deps: ServerDependencies,
  type: AuditEventType,
  payload: Record<string, unknown>,
  correlationId?: string,
): Promise<void> {
  if (!deps.auditLog) return;
  try {
    const principalTenantId = deps.authorizationPrincipal?.tenantId;
    await deps.auditLog.append({
      type,
      ...(principalTenantId ? { tenantId: principalTenantId } : {}),
      ...(correlationId ? { correlationId } : {}),
      payload,
    });
  } catch (error) {
    deps.logger.error('audit_append_failed', { error: String(error), type });
  }
}

function errorResponse(code: string, message: string): ErrorResponseBody {
  return { error: { code, message } };
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
 * Authorization is evaluated server-side before retrieval; denied requests
 * receive 401/403 and never reach the pipeline.
 */
export function createHttpServer(deps: ServerDependencies): http.Server {
  const { config, embeddingProvider, vectorStore, languageModel, logger, metrics } = deps;

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
        let receivedBytes = 0;
        for await (const chunk of req) {
          const data = chunk as string;
          receivedBytes += Buffer.byteLength(data);
          if (receivedBytes > MAX_REQUEST_BODY_SIZE) {
            sendError('bad_request', 'request body too large', 413);
            return;
          }
          raw += data;
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

        // Correlation ID links query → retrieval → generation audit events.
        const correlationId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Audit: request received and validated.
        await emitAudit(deps, 'query.received', {
          query,
          topK: validated.value.topK ?? 5,
          tenantId: validated.value.tenantId,
        }, correlationId);

        // Gateway-level tenant throttling: rate limit, quota, and RBAC are
        // enforced before any pipeline call. Fail closed on limit exceeded.
        const tenantId = resolveTenantId(req, validated.value, deps);

        if (deps.rateLimiter && tenantId) {
          if (!deps.rateLimiter.allow(tenantId)) {
            metrics.increment('http_429');
            sendError('rate_limited', 'tenant rate limit exceeded', 429);
            return;
          }
        }

        const quota = checkTenantQuota(tenantId, deps);
        if (!quota.allowed) {
          metrics.increment('http_429');
          sendError('rate_limited', quota.reason ?? 'tenant quota exceeded', 429);
          return;
        }

        const roles = checkRequiredRoles(deps);
        if (!roles.allowed) {
          sendError('forbidden', roles.reason ?? 'insufficient role', 403);
          return;
        }

        // Resolve trusted authorization context before any pipeline call.
        // Fail closed: no principal or denied policy → 401/403, never 200.
        let authz: { context: AuthorizationContext; evaluate?: AuthorizationEvaluator } | undefined;
        if (deps.authorizationPolicy || deps.authorizationTenantConfig) {
          const policy =
            deps.authorizationPolicy ??
            makeAuthorizationPolicy(deps.authorizationTenantConfig!);
          const principal = deps.authorizationPrincipal;
          if (!principal) {
            await emitAudit(deps, 'query.authorization_denied', {
              reason: 'missing trusted principal',
              tenantId: tenantId,
            }, correlationId);
            sendError('unauthorized', 'missing trusted principal', 401);
            return;
          }
          const decision = await policy(principal, {
            text: query,
            topK: validated.value.topK ?? 5,
            ...(validated.value.tenantId ? { tenantId: validated.value.tenantId } : {}),
          });
          if (!decision.allowed) {
            await emitAudit(deps, 'query.authorization_denied', {
              reason: decision.reason,
              tenantId: decision.tenantId,
            }, correlationId);
            sendError('forbidden', decision.reason, 403);
            return;
          }
          const components = decisionToAuthzComponents(decision);
          authz = {
            context: components.context,
          };
        }

        const retrieveRequest: RetrieveRequest = {
          text: query,
          topK: validated.value.topK ?? 5,
        };
        if (validated.value.tenantId !== undefined) {
          retrieveRequest.tenantId = validated.value.tenantId;
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
          await emitAudit(deps, 'query.retrieval_error', {
            issues: retrieved.issues.map((i) => ({ path: i.path, message: i.message })),
          }, correlationId);
          sendError('retrieval_error', retrieved.issues.map((i) => `${i.path}: ${i.message}`).join('; '), 502);
          return;
        }

        // Audit: retrieval completed with candidate IDs and scores.
        await emitAudit(deps, 'query.retrieved', {
          candidateCount: retrieved.value.length,
          candidateIds: retrieved.value.map((r) => r.chunk.id),
          sourceIds: retrieved.value.map((r) => r.sourceId),
          filters: { tenantId: retrieveRequest.tenantId },
        }, correlationId);

        let answer;
        if (retrieved.value.length === 0) {
          await emitAudit(deps, 'generation.insufficient_context', {
            query,
          }, correlationId);
          answer = {
            text: `Insufficient retrieved evidence to answer: "${query}".`,
            citations: [],
            insufficientContext: true,
          };
        } else {
          // Audit: generation started.
          await emitAudit(deps, 'generation.started', {
            contextCount: retrieved.value.length,
          }, correlationId);

          const generated = await generateGroundedAnswer(
            { query, context: retrieved.value },
            {
              model: languageModel,
              ...(config.llm ? { expectedModel: config.llm.model } : {}),
              ...(config.llm?.timeoutMs ? { timeoutMs: config.llm.timeoutMs } : {}),
            },
          );

          if (!generated.ok) {
            await emitAudit(deps, 'generation.error', {
              issues: generated.issues.map((i) => ({ path: i.path, message: i.message })),
            }, correlationId);
            sendError('generation_error', generated.issues.map((i) => `${i.path}: ${i.message}`).join('; '), 502);
            return;
          }

          await emitAudit(deps, 'generation.completed', {
            citationsCount: generated.value.citations.length,
            insufficientContext: generated.value.insufficientContext,
          }, correlationId);

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
