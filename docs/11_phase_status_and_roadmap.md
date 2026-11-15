---
title: "Phase Status and Forward Roadmap"
artifact_id: RAG-PLAN-004
package_part: "roadmap"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase Status and Forward Roadmap

## Scope
This document records (a) which implementation phases are complete for the **local baseline**, (b) the verified evidence behind each, and (c) the forward roadmap of remaining phases and sub-phases. The canonical phase definitions and exit criteria live in `AGENTS.md` §17; this document is the human-readable status record.

"Complete" means the phase's deliverables exist, are tested where testable, and are documented. It does **not** mean production, enterprise, compliance, or scale readiness. All baseline evidence is local/synthetic: deterministic mocks, in-memory store, no real providers, paid APIs, or cloud services.

## Completed baseline (Phases 0–9)

| Phase | Status | Verified evidence | Main artifacts |
|---|---|---|---|
| 0 — Audit & Baseline | Complete | Implementation inventory, pipeline map, recorded baseline checks | `README.md`, `docs/01`–`docs/03` (target docs), this roadmap |
| 1 — TypeScript Foundation | Complete | ESM/NodeNext `src/` → `dist/` build, strict `tsconfig`, typed config validation, Vitest baseline | `package.json`, `tsconfig.json`, `src/types.ts`, `src/config.ts`, `tests/config.test.ts`, `.env.example` |
| 2 — Ingestion & Chunking | Complete | Text parsing (`.txt/.md/.markdown/.text`), deterministic chunking with validated size/overlap, content hashes, idempotent batch ingestion | `src/ingest.ts`, `tests/ingest.test.ts`, `tests/chunk.test.ts`, `tests/ingest-batch.test.ts` |
| 3 — Embeddings & Indexing | Complete | Provider/store contracts, model + dimension validation, `MemoryVectorStore` upsert/query/delete lifecycle, retry/resilience helpers | `src/embeddings.ts`, `src/vector-store.ts`, `src/memory-store.ts`, `src/resilience.ts`, related tests |
| 4 — Retrieval & Access Filtering | Complete | Baseline dense retrieval, optional reranker hook, trusted fail-closed tenant/document filtering | `src/retrieve.ts`, `tests/retrieve.test.ts` |
| 5 — Grounded Generation & Citations | Complete | System/user/evidence isolation, citation restriction to retrieved sources, insufficiency handling, timeout / expected-model / malformed-output handling | `src/generate.ts`, `tests/generate.test.ts` |
| 6 — Evaluation & Regression | Complete | Synthetic golden set v0.1.0 (n=3); mock baseline Recall@3 = 1.0, MRR = 1.0; regression guard via `npm run evaluate` | `data/eval/golden-v0.1.0.json`, `data/eval/baselines/golden-v0.1.0.baseline.json`, `src/eval.ts`, `tests/eval.smoke.test.ts`, `docs/04`, `docs/05` |
| 7 — Security & Isolation | Complete | Threat/control review, cross-tenant + prompt-injection tests, compliance gap assessment | `docs/06`, `docs/07`, `tests/security.test.ts` |
| 8 — Operations & Cost | Complete | Local mock benchmark, privacy-conscious observability primitives, deployment/cost/readiness assessment | `scripts/benchmark-smoke.mjs`, `src/observability.ts`, `tests/observability.test.ts`, `docs/08`, `docs/09`, `docs/10` |
| 9 — Docs & Release Readiness | Complete | README/docs aligned to actual behavior, command verification (`typecheck`/`test`/`build`/`evaluate`/benchmark all passing), handover report | `README.md`, `docs/02` (Mermaid preserved), handover summary in session |

### Verification commands for the baseline (as run and reported)

| Command | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm test` | pass — 12 test files, 57 tests |
| `npm run build` | pass (exit 0) |
| `npm run evaluate` | pass — 1 file, 1 test (synthetic smoke eval) |
| `node scripts/benchmark-smoke.mjs` | pass — local in-memory/mock micro-benchmark |

Re-run these commands after any change; do not carry forward stale results.

## Known baseline limits (do not overstate)

- Text-only ingestion (`.txt/.md/.markdown/.text`); no PDF/HTML/DOCX/EML/XLSX/OCR/table parsing.
- No real embedding, LLM, or vector-database adapters; `MemoryVectorStore` only; no durable persistence.
- No service/API runtime, no production authentication boundary, no centralized audit logging.
- Multi-tenancy, erasure cascade, and residency are design targets with local primitives/tests only.
- Evaluation is synthetic and mock-based (n=3); benchmark is local in-memory — not evidence of quality, latency, throughput, cost, or SLOs at scale.
- Enterprise architecture (`docs/01`–`docs/03`, `plan.md`: AWS, SOC 2 Type II, GDPR, 10M+ docs) remains a **target design**, not implemented or verified compliance.

## Forward roadmap (Phases 10–14)

Canonical sub-phase definitions and exit criteria are in `AGENTS.md` §17. Summary:

| Phase | Goal | Sub-phases | Exit signal |
|---|---|---|---|
| 10 — Real Providers and Persistent Stores | Replace mocks/in-memory with configured integrations behind existing interfaces | 10.1 Embedding adapter ✅ done · 10.2 Vector store adapter ✅ done · 10.3 LLM gateway adapter ✅ done · 10.4 Integration tests & setup docs | Adapters honor existing contracts; model/dimension checks enforced; failures explicit (no silent fallback); setup docs accurate; any paid/external usage explicitly authorized and measured |

### Phase 10.1 — Embedding adapter (complete)

Implemented `src/embedding-provider.ts` — a generic OpenAI-compatible HTTP embeddings adapter behind the existing `EmbeddingProvider` contract:

- `HttpEmbeddingProvider` POSTs `input` + `model` to `{baseUrl}/embeddings` and returns typed `Embedding[]` (chunk ids derived from call order / chunk id).
- Enforces model/version pinning and dimensions against responses; rejects mismatches.
- Per-request timeout via `AbortController`; bounded retries for transient 429/5xx via existing `withRetry`/`isRetryableProviderError`.
- Fail-closed: provider failures surface as thrown errors (caller converts to `Result` issues), no partial success, no silent fallback.
- Secrets: API key sent in `Authorization: Bearer` header, never logged or echoed in error messages.
- Tests: `tests/embedding-provider.test.ts` (11 cases, mocked `fetch` — no paid provider quota used).
- Config: optional `EMBEDDING_BASE_URL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY`, `EMBEDDING_TIMEOUT_MS` parsed by `parsePipelineConfig` (`.env.example` updated).

Next within Phase 10: **10.2 Vector store adapter** ✅ done (below).

### Phase 10.2 — Vector store adapter (complete)

Implemented `src/qdrant-store.ts` — a Qdrant Cloud vector store adapter behind the existing `VectorStore` contract:

- `QdrantStore` wraps `@qdrant/js-client-rest` (`QdrantClient`): connects to `VECTOR_DB_URL` with `VECTOR_DB_API_KEY`, writes to `QDRANT_COLLECTION`.
- Deterministic chunk-id→UUID mapping (`chunkIdToPointId`) since Qdrant point ids must be UUIDs or numbers; original chunk id preserved in payload `chunk_id`.
- Qdrant Cloud strict mode: `document_id` and `tenant_id` payload indexes created on first upsert (`createPayloadIndex`).
- Server-side filter pushdown: `tenant_id` and `document_id` filters sent in the Qdrant query filter (never client-side only).
- Idempotent upsert (`wait: true`), delete-by-document-id (Qdrant returns no count → reports `-1`), dimension validation on upsert/query.
- Fail-closed: Qdrant client errors surface as `Result` issues; no partial success, no silent fallback; API key never logged or echoed in error messages.
- Tests: `tests/qdrant-store.test.ts` (9 cases, spied `QdrantClient` prototype — no real cloud calls).
- Config: `VECTOR_DB_URL`, `VECTOR_DB_API_KEY`, `QDRANT_COLLECTION` (`.env.example` updated).

Next within Phase 10: **10.3 LLM gateway adapter** ✅ done (below).

### Phase 10.3 — LLM gateway adapter (complete)

Implemented `src/llm-provider.ts` — a generic OpenAI-compatible HTTP chat completions adapter behind the existing `LanguageModel` contract:

- `HttpLLMProvider` POSTs `model` + `messages` (system + user with evidence) to `{baseUrl}/chat/completions` and returns typed `ModelGeneration` (`text`, `insufficientContext`).
- Enforces model pinning against responses; rejects mismatches.
- Per-request timeout via `AbortController`.
- Fail-closed: provider failures surface as thrown errors (caller `generateGroundedAnswer` converts to `Result` issues), no partial success, no silent fallback; API key never logged or echoed in error messages.
- Tests: `tests/llm-provider.test.ts` (10 cases, mocked `fetch` — no paid provider quota used).
- Config: optional `LLM_BASE_URL`, `LLM_TIMEOUT_MS` parsed by `parsePipelineConfig` (`.env.example` updated).

Next within Phase 10: **10.4 Integration tests & setup docs** ✅ done (below).

### Phase 10.4 — Integration tests & setup docs (complete)

Implemented integration tests and setup documentation for the provider adapters:

- Created `tests/integration-pipeline.test.ts` — end-to-end embed → store → retrieve pipeline tests using mocked `fetch` responses (no paid provider quota used). Covers successful end-to-end flow, empty store results, and provider failure propagation.
- Updated `README.md` with integration test setup guidance: run via `npm test`, mock `globalThis.fetch` pattern, and explicit instruction not to add paid API calls to the default suite.
- Updated `.env.example` and `README.md` configuration sections to document all optional provider env vars.

Next within Phase 10: none — Phase 10 complete.

### Phase 11.1 — Query transformation (complete)

Implemented query transformation (rewrite/decompose/expand) as an optional hook in the retrieval pipeline:

- Added `QueryTransformationOptions`, `QueryTransformationResult`, and `QueryTransformer` types to `src/types.ts`.
- Extended `RetrieverDependencies` in `src/retrieve.ts` with optional `queryTransformer` hook.
- `retrieve()` transforms the original query into variants when the hook is present; each variant is embedded and retrieved; results are merged via reciprocal-rank fusion (RRF, k=60) and re-ranked by fused score.
- Bypass path: when no `queryTransformer` is configured, behavior is unchanged (single query, direct retrieval).
- Fail-closed: transformer errors or empty results fall back to the original query only.
- Deduplication: the original query is always included; duplicate variants are removed.
- Tests: `tests/retrieve-query-transform.test.ts` (7 cases covering bypass, RRF merge, transformer failure, ok:false, empty variants, deduplication, and document allowlist after merge).
- No new dependencies; uses existing `EmbeddingProvider`, `VectorStore`, and `withRetry` patterns.

Next within Phase 11: **11.2 Sparse/hybrid retrieval + RRF fusion** ✅ done (below).

### Phase 11.2 — Sparse/hybrid retrieval + RRF fusion (complete)

Implemented sparse/hybrid retrieval with RRF fusion in `src/retrieve.ts`:

- Added `SparseVector`, `SparseEmbedding`, `SparseRetrievalResult`, `HybridRetrievalOptions`, and `SparseVectorStore` types to `src/types.ts`.
- Extended `RetrieverDependencies` with optional `sparseStore` and `hybridOptions`.
- `retrieve()` runs dense retrieval (existing path) and, when hybrid is enabled AND a `sparseStore` is provided, also runs sparse retrieval; results are fused via multi-source RRF (`multiSourceRRF`) and deduplicated by chunk ID.
- Dense-only remains the default baseline path — hybrid is opt-in via `hybridOptions.enabled`.
- Fail-closed: sparse retrieval failures don't fail the whole query; dense results are still returned.
- Server-side document allowlist applied after fusion; optional reranker and topK cap preserved.
- Tests: `tests/retrieve-hybrid.test.ts` (6 cases covering dense-only baseline, hybrid off with sparseStore present, RRF fusion ranking, sparse failure fallback, document allowlist after fusion, and empty results).

Next within Phase 11: **11.4 Representative evaluation** ✅ done (below).

### Phase 11.4 — Representative evaluation (complete)

Expanded the synthetic golden dataset and added before/after delta tracking:

- Created `data/eval/golden-v0.2.0.json` — expanded synthetic golden dataset from n=3 to n=10 cases, still clearly labelled as synthetic/mock with limitations documented.
- Created `data/eval/baselines/golden-v0.2.0.baseline.json` — measured baseline metrics (Recall@3=1.0, MRR=1.0, 3 insufficient-context cases) with before/after delta vs v0.1.0 (sampleSize delta=7, metric deltas=0).
- Updated `tests/eval.smoke.test.ts` — runs against v0.2.0 dataset (n=10), reports retrieval metrics + generation insufficient-context count + deltas vs v0.1.0.
- Updated `docs/05_evaluation_baseline.md` — references v0.2.0 dataset and baseline.
- Explicitly framed as synthetic smoke evidence only; not statistically meaningful or production-representative.

Next within Phase 11: none — Phase 11 complete.

### Phase 12.1 — API/runtime boundary (complete)

Implemented a minimal HTTP service boundary for the RAG pipeline in `src/server.ts`:

- `createHttpServer(deps)` wraps Node's built-in `http` module (no new dependencies).
- Endpoints: `GET /health` (200 `{status:'ok'}`), `GET /ready` (200 `{status:'ready'}` when deps wired, else 503), `POST /query` (validate body → retrieve + generate → return answer).
- Request validation before any pipeline call: query required non-empty string, topK positive integer, tenantId non-empty string; invalid bodies return structured 400 errors.
- Structured JSON error responses (`{ error: { code, message } }`) with appropriate status codes (400/404/502/503/500); secrets and provider internals never leaked.
- Integrates existing pipeline: `retrieve()` + `generateGroundedAnswer()`, with optional reranker and authorization.
- Observability: structured logging via `createStructuredLogger`, metrics via `MetricsRecorder` (counters + timing).
- Exports `ServerDependencies`, `QueryRequestBody`, `QueryResponseBody`, `ErrorResponseBody`, `createHttpServer` from `src/index.ts`.
- Tests: `tests/server.test.ts` (9 cases covering health, ready, query success, insufficient context, validation errors, bad JSON, 404, ready-unavailable).

Next within Phase 12: **12.2 Server-side authorization** ✅ done (below).

### Phase 12.2 — Server-side authorization (complete)

Implemented server-side authorization enforcement at the API boundary in `src/authorization.ts` and `src/server.ts`:

- Added `AuthorizationPrincipal`, `AuthorizationDecision`, `AuthorizationPolicy`, and `TenantAuthorizationPolicyConfig` types to `src/types.ts`.
- Created `src/authorization.ts` with `TenantAuthorizationPolicy` class:
  - Tenant isolation: principal's tenantId must match the configured tenant (cross-tenant access denied).
  - Document allow-list: if configured, every document referenced by the request must be in the allow-list.
  - Fail-closed: missing principal, tenant mismatch, document mismatch, or policy errors all produce `allowed: false`.
  - Never logs principal identifiers or document contents.
  - `makeAuthorizationPolicy()` factory returns a callable `AuthorizationPolicy`.
  - `decisionToAuthzComponents()` converts decisions to `RetrievalAuthorization` context for `retrieve()`.
- `src/server.ts` updated: `ServerDependencies` accepts optional `authorizationPolicy` and `authorizationPrincipal`. The `/query` handler resolves the principal, evaluates the policy before any pipeline call, returns 401 for missing principal and 403 for denied decisions. Client-supplied `tenantId` in the request body is not trusted.
- Tests: `tests/authorization.test.ts` (8 cases covering tenant isolation, cross-tenant denial, missing tenant, document allow-list, factory, decision conversion) plus 3 server integration cases (valid principal → 200, cross-tenant → 403, no principal → 401).

Next within Phase 12: **12.3 Durable ingestion lifecycle** ✅ done (below).

### Phase 12.3 — Durable ingestion lifecycle (complete)

Implemented durable ingestion lifecycle tracking in `src/ingestion-lifecycle.ts`:

- Added `IngestedSourceRecord`, `IngestionLifecycleResult`, and `ReindexDecision` types to `src/types.ts`.
- Created `src/ingestion-lifecycle.ts` with `IngestionLifecycleTracker` class:
  - `shouldReindex(documentId, contentHash)` — compares content hash against stored hash to detect new/changed/unchanged sources.
  - `recordIngestion(...)` — records source metadata (content hash, ingestedAt, chunk count, version) for re-index detection.
  - `recordChunks(...)` — maps chunk IDs to documents for lifecycle tracking.
  - `deleteDocument(documentId, store, verifyDeletion?)` — deletes from store, runs verification sweep, clears tracking. Fail-closed on store failure or residual chunks.
  - `erasureDocument(documentId, store, verifyDeletion?)` — same as delete with explicit erasure operation type for GDPR-style erasure auditing.
  - `reindexDocument(...)` — records updated ingestion after re-chunk/re-embed/re-upsert.
  - `getSourceRecords()` / `recordSource()` — serialization/rehydration for durability across restarts.
- Pluggable `verifyDeletion` function (default queries store with topK: 1 to check for residual chunks).
- Tests: `tests/ingestion-lifecycle.test.ts` (11 cases covering re-index decisions, source tracking, deletion with verification, store failure handling, residual chunk detection, erasure, re-index, and source count).
- Exports `IngestedSourceRecord`, `IngestionLifecycleResult`, `ReindexDecision` types and `IngestionLifecycleTracker` from `src/index.ts`.

Next within Phase 12: **12.4 Deployment & runbooks** ✅ done (below).

### Phase 12.4 — Deployment & runbooks (complete)

Added deployment & runbook documentation in `docs/10_deployment_cost_readiness.md`:

- Runbooks R-1 through R-10 covering: local development start, health check, readiness check, query operation, config validation failure, evaluation/regression check, smoke benchmark, ingestion lifecycle (re-index/delete/erasure), incident response, and explicit "what NOT to do" limits.
- Deployment considerations clarified: library-only baseline, not yet a standalone production service; no AWS/EKS/Qdrant/S3/KMS assumed.
- Readiness assessment: ready for local development/unit verification/synthetic smoke evaluation; not ready for production, multi-tenant, regulated data, SOC 2/GDPR claims, or high-scale operation.
- Cost controls: do not incur paid API/cloud usage or transmit restricted data without explicit authorization.

Next within Phase 12: none — Phase 12 complete.

### Phase 13.1 — Audit trail (complete)

Implemented append-only audit trail with integrity protection in `src/audit.ts`:

- Added `AuditEvent`, `AuditEventType`, `AuditLog`, `AuditLogConfig`, `AuditRedactionLevel` types to `src/types.ts`.
- Created `src/audit.ts` with `AuditLogImpl` class implementing `AuditLog`:
  - Append-only events with monotonically increasing sequence numbers.
  - Hash-chain integrity: each event's hash = SHA-256(seq + timestamp + type + JSON(payload) + previousHash).
  - Payload redaction: sensitive keys (apiKey, authorization, token, secret, password, cookie, prompt, evidence, content, document, chunk) replaced with `[REDACTED]`; user/tenant/document IDs SHA-256 hashed.
  - Retention: configurable maxEvents and retentionDays with automatic eviction of oldest events.
  - Integrity verification: `verifyIntegrity()` walks the chain and returns false if any link is broken.
  - Fail-closed: append failures throw; integrity failures are returned, never silently ignored.
- Tests: `tests/audit.test.ts` (7 cases covering append/hash chain, integrity verification, hash sensitivity, payload redaction, maxEvents retention, seq range/limit reads).
- Exports `AuditEvent`, `AuditEventType`, `AuditLog`, `AuditLogConfig`, `AuditRedactionLevel` types and `AuditLogImpl`, `createAuditLog` from `src/index.ts`.

Next within Phase 13: **13.2 Erasure & residency** ✅ done (below).

### Phase 13.2 — Erasure & residency (complete)

Implemented erasure cascade and residency enforcement in `src/erasure.ts`:

- Added `ResidencyRule`, `ResidencyCheckResult`, `ErasureRequest`, `ErasureResult`, `ErasureService`, `ResidencyPolicy` types to `src/types.ts`.
- Created `src/erasure.ts`:
  - `DefaultResidencyPolicy` implements `ResidencyPolicy`: enforces that tenant data may only reside in the configured region; fail-closed on missing rule or region mismatch.
  - `DefaultErasureService` implements `ErasureService`: cascades deletion across D1 (raw), D2 (vector), D4 (policy) stores, then runs a verification sweep checking for residual chunks; fail-closed on store failures or residual chunks.
  - `createErasureService(d2Store)` and `createResidencyPolicy(rules)` factory functions.
  - `checkResidency(policy, rule, targetRegion, tenantId)` helper.
- Tests: `tests/erasure.test.ts` (8 cases covering residency allow/deny/cross-tenant, erasure cascade, store failure fail-closed, residual chunk detection, per-store results).
- Exports `ErasureRequest`, `ErasureResult`, `ErasureService`, `ResidencyCheckResult`, `ResidencyPolicy`, `ResidencyRule` types and `DefaultErasureService`, `DefaultResidencyPolicy`, `createErasureService`, `createResidencyPolicy`, `checkResidency` from `src/index.ts`.

Next within Phase 13: **13.3 Red-team suites** ✅ done (below).

### Phase 13.3 — Red-team suites (complete)

Implemented adversarial security testing in `tests/red-team.test.ts`:

- Added red-team test suite covering cross-tenant access, privilege escalation, prompt injection resistance, and fail-closed authorization:
  - Cross-tenant access denied when request tenant mismatches trusted context
  - Client-supplied tenant filter denied without trusted authz context (fail closed)
  - Trusted authz context matching request tenant allows retrieval
  - Authorization evaluator throwing errors fails closed (403)
  - Authorization evaluator returning ok:false fails closed (403)
  - Document allow-list filtering applied server-side
  - Same embedding vector across tenants doesn't leak cross-tenant chunks
  - citedChunkIds for chunks not in retrieved context are rejected
  - expectedModel fail-closed rejects unapproved models
- Updated `src/retrieve.ts` `resolveAuthorizedFilters` to fail closed when a client-supplied tenantId is present without trusted authz context
- Tests: `tests/red-team.test.ts` (9 cases covering cross-tenant isolation, fail-closed authorization, document allow-list, citation claim validation, expectedModel enforcement)

Next within Phase 13: **13.4 Evidence pack & gap assessment** ✅ done (below).

### Phase 13.4 — Evidence pack & gap assessment (complete)

Updated the compliance gap assessment with verified controls from Phases 13.1-13.3:

- Added `Audit trail (baseline)` row to verified controls table — `src/audit.ts`, `tests/audit.test.ts` — append-only log with hash-chain integrity, payload redaction, retention config
- Added `Erasure & residency (baseline)` row — `src/erasure.ts`, `tests/erasure.test.ts` — erasure cascade across D1/D2/D4 stores, verification sweep, residency policy enforcement with fail-closed
- Added `Red-team suites` row — `tests/red-team.test.ts` — cross-tenant access denial, prompt injection resistance, expectedModel fail-closed, citation claim validation
- Updated `docs/07_compliance_gap_assessment.md` verified controls table with all three new rows

All Phase 13 sub-phases complete: 13.1 audit trail, 13.2 erasure & residency, 13.3 red-team suites, 13.4 evidence pack & gap assessment.

### Phase 14.1 — Realistic workload baselines (complete)

Implemented `scripts/benchmark-realistic.mjs` — a realistic workload benchmark for Phase 14.1:

- Uses the real provider adapter classes (`HttpEmbeddingProvider`, `QdrantStore`, `HttpLLMProvider` from Phase 10) — not inline mocks. When `EMBEDDING_BASE_URL`, `VECTOR_DB_URL`, and `LLM_BASE_URL` are configured with non-mock endpoints, the adapter classes connect to real providers; otherwise deterministic mocks are used.
- Measures latency percentiles (p50/p95/p99), mean, stdDev, min, max for retrieval and generation stages; throughput (queries/sec); failure rate; and ingestion latency/count.
- Supports concurrency via `runConcurrent` helper — runs multiple queries concurrently with configurable concurrency level.
- Records full environment and configuration (Node version, platform, arch, CPU count, memory, and redacted env var values) — never logs secret values.
- Clearly labels results: when real providers are configured, results reflect real provider measurement; when using mocks, results are explicitly labeled as synthetic and not production evidence.
- Uses the v0.2.0 golden dataset (n=10 cases) for a more representative workload than the v0.1.0 smoke set.
- No new dependencies; uses existing provider adapters from Phase 10 and pipeline modules from Phases 4-5.

Tests: verified by manual execution (`node scripts/benchmark-realistic.mjs`) — passes with both mock and concurrent modes. No paid provider quota used.

Next within Phase 14: **14.2 Runtime controls under load**.

### Phase 14.2 — Runtime controls under load (complete)

Implemented runtime controls in `src/runtime-controls.ts`:

- `ConcurrencyLimiter` — bounds concurrent operations with a configurable max concurrent and queue size. Rejects when queue is full or acquire timeout expires. Tracks concurrency metrics (active, queued, completed, rejected, timeouts).
- `CircuitBreaker` — tracks failures and opens circuit after failure threshold. Fail-closed: calls fail fast while open. After recovery timeout, transitions to half-open and allows limited trial calls. If half-open calls succeed, closes circuit; if any fail, re-opens.
- `SimpleCache` — TTL cache with max size and LRU eviction. Tracks hits/misses/size.
- `RuntimeControls` — combines limiter, breaker, and cache into a single facade. `execute(key, op)` runs an operation through cache check → limiter → breaker → execute → cache store pipeline.

Tests: `tests/runtime-controls.test.ts` (14 cases covering concurrency limiting, queue rejection, timeout, circuit breaker open/half-open/close transitions, cache TTL/eviction/hit-miss, and combined runtime controls snapshot).

Next within Phase 14: **14.3 Cost measurement & capacity**.

### Phase 11.3 — Reranking & thresholding (complete)

Implemented the existing `RetrievalReranker` hook with a concrete scorer and explicit refusal threshold:

- Added `RerankerConfig` (minScore, maxResults) types to `src/types.ts`.
- Created `src/reranker.ts` with `LexicalReranker` class implementing `RetrievalReranker`:
  - Scores results by token overlap between query and chunk content (no external model, no network calls).
  - Drops results below `minScore` threshold (empty-context refusal → insufficient context in generation).
  - Caps results at `maxResults`.
  - Fail-closed: errors surface as `Result` issues; no partial success, no silent fallback; never logs chunk content.
- `LexicalReranker` is exported from `src/index.ts` and assignable to the `RetrievalReranker` hook in `RetrieverDependencies`.
- `retrieve()` already calls `deps.reranker` when present; when the reranker drops all results below threshold, empty context flows to `generateGroundedAnswer` which returns `insufficientContextAnswer`.
- Tests: `tests/reranker.test.ts` (7 cases covering re-ranking by overlap, minScore threshold refusal, all-below-threshold empty, maxResults cap, empty query, RetrievalReranker assignability, and retrieve() integration with refusal).

Next within Phase 11: **11.4 Representative evaluation**.
| 11 — Retrieval Quality and Query Processing | Improve evidence quality with measured, reproducible changes | 11.1 Query transformation ✅ done · 11.2 Sparse/hybrid + fusion ✅ done · 11.3 Reranking & thresholding ✅ done · 11.4 Representative evaluation ✅ done | Every change measured on a versioned dataset; dense-only path preserved; no quality claim without recorded evidence |
| 12 — Service Boundary and Durable Lifecycle | Add a real runtime boundary and durable document lifecycle | 12.1 API/runtime boundary ✅ done · 12.2 Server-side authorization ✅ done · 12.3 Durable ingestion lifecycle ✅ done · 12.4 Deployment & runbooks ✅ done | Authorization enforced before context exposure; lifecycle tested/observable; runbooks match implementation |
| 13 — Security, Privacy, and Compliance Evidence | Convert design targets into verifiable evidence | 13.1 Audit trail ✅ done · 13.2 Erasure & residency ✅ done · 13.3 Red-team suites ✅ done · 13.4 Evidence pack & gap assessment ✅ done | Verified controls have test/evidence artifacts; gaps documented; no compliance claim without evidence |
| 14 — Realistic Performance, Cost, and Release | Validate under realistic workloads; evidence-backed release | 14.1 Realistic workload baselines ✅ done · 14.2 Runtime controls under load ✅ done · 14.3 Cost measurement & capacity · 14.4 Release readiness & handover | Performance/cost claims backed by repeatable measurements on documented configurations |

### Dependencies and ordering
- **Phase 10** is the default next increment (smallest useful slice: one adapter at a time).
- **Phase 11** benefits from real providers/stores for meaningful measurement; it may proceed with mocks only if labelled as synthetic.
- **Phase 12** requires Phase 10 store/provider decisions (persistent store semantics, tenancy fields).
- **Phase 13** requires Phase 12 runtime boundaries for meaningful isolation/audit evidence.
- **Phase 14** requires Phases 10–12 for realistic measurement.

### Working rules for future phases
- One sub-phase per task by default; smallest safe increment with tests.
- Ask before adding paid services, new vector databases, cloud infrastructure, destructive re-index/deletion, or compliance/security claims.
- Keep provider SDK details behind the existing interfaces; keep secrets in env/config only.
- Update `AGENTS.md` §17 status table, this document, `README.md`, and affected `docs/` whenever a phase's status or public behavior changes.

## How to update this document
1. When a phase/sub-phase completes, update the status table (this file) and the status table in `AGENTS.md` §17 with the **actual** evidence (commands run, results, artifacts).
2. Re-run `npm run typecheck`, `npm test`, `npm run build`, `npm run evaluate`, and (where relevant) `node scripts/benchmark-smoke.mjs`; record real results only.
3. If public behavior, configuration, or commands changed, update `README.md` and the relevant `docs/` file in the same change.
4. Move the phase from "forward roadmap" to "completed baseline" only when its exit criteria are met — partial progress stays in the roadmap table with an explicit note.
