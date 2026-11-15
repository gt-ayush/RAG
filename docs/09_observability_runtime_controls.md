---
title: "Observability & Runtime Controls Review"
artifact_id: RAG-OPS-002
package_part: "operations"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase 8.2 — Observability & Runtime Controls

## Scope
Review of current runtime controls and addition of privacy-conscious observability primitives consistent with the existing TypeScript/library architecture (no production service/runtime framework assumed).

## Structured logging and metrics (implemented primitives)
- **`src/observability.ts`** provides:
  - `createStructuredLogger(...)` emitting JSON `LogEvent`s (`level`, `event`, `timestamp`, sanitized `data`).
  - `sanitizeLogData(...)` redacting sensitive keys by pattern (e.g. `apiKey`, `authorization`, `token`, `secret`, `password`, `cookie`, `prompt`, `evidence`, `content`, `document`, `chunk`), truncating long strings, and collapsing arrays/objects to non-content summaries.
  - `MetricsRecorder` for in-process counters and timing summaries (`count/min/max/avg`) snapshots.
- **Privacy posture:** primitives are designed to avoid logging secrets and document/prompt/evidence content by default; callers/adapters must still avoid passing sensitive material into log events and must not log raw provider payloads or credentials.
- **Not implemented:** centralized log aggregation, distributed tracing, alerting, dashboards, audit-log/WORM pipeline, or automatic instrumentation across all modules (primitives available for future integration).

## Runtime controls review (current state)

| Control | Current state (verified) | Gaps / notes |
|---|---|---|
| **Timeouts** | Generation supports optional `timeoutMs` (`src/generate.ts`) and fails with explicit error. | No global/default timeout policy, no retrieval/embedding/store timeouts, no cancellation propagation to providers. |
| **Retries** | Bounded retry helper (`src/resilience.ts`) with retryable classification; used by `embedChunksWithValidation` (opt-in `maxAttempts/baseDelayMs`). | No default retry policy wiring for all provider/store calls, no jitter/circuit breaker/hedging, no idempotency tokens for non-idempotent external operations. |
| **Concurrency** | Sequential in-process execution in current scripts/tests/baseline paths. | No concurrency limiter, worker pool, queue, or per-tenant fairness controls implemented. |
| **Rate limiting** | Retryable classification recognizes rate-limit signals (e.g. 429); no enforcement. | No client/server-side rate limiting, token budgets, or backoff coordination across requests/tenants. |
| **Backpressure** | None implemented. | No queue bounds, load shedding, admission control, or overload signaling for ingestion/retrieval/generation pipelines. |
| **Caching** | None implemented. | No embedding/query/result cache; repeated work recomputed. Caching (if added) must respect authz/tenant isolation and invalidation on updates/deletes. |
| **Resource cleanup** | Generation timeout clears timer in `finally`; in-memory store uses scoped structures; no persistent connections. | No connection pool lifecycle, stream/file-handle management beyond Node defaults, or graceful shutdown hooks for future long-running services. |

## Failure modes and observability implications
- **Provider/network failures:** surfaced as explicit `Result` issues/errors (generation/embedding wrappers); metrics/logging hooks can record failure counts/latency when integrated.
- **Authorization/policy failures:** fail closed in retrieval path (no context leakage) — suitable for security/audit event metrics without logging sensitive query/content.
- **Input/validation failures:** explicit issues for config, parsing, chunking, embeddings, retrieval, and malformed model outputs.
- **Unobserved in production:** real latency distributions, saturation, queue depth, external dependency health, cost, and multi-tenant contention (no production runtime).

## Recommendations (next increments)
1. Integrate logger/metrics hooks at pipeline boundaries (ingest/retrieve/generate/store/provider adapters) with strict redaction and no content/secret logging.
2. Add configurable timeout/retry defaults per operation type and bounded concurrency/backpressure for batch ingestion and request handling.
3. Introduce rate limiting/token budgeting and cache strategies only with tenant-aware keys and invalidation semantics.
4. Add health/readiness/error metrics and traces when a service runtime is introduced (Phase 8.3), keeping privacy/compliance constraints explicit.