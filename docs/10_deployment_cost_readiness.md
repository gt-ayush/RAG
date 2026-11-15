---
title: "Deployment, Cost, and Readiness Assessment"
artifact_id: RAG-OPS-003
package_part: "operations"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase 8.3 — Deployment, Cost, and Readiness

## Scope
This assessment defines **actual** configuration/deployment needs and readiness based on the current repository implementation. It does not assume cloud infrastructure, managed services, or production topology exists.

## Current implementation shape (actual)
- **Runtime:** Node.js/TypeScript library modules (ESM, `type: module`, `nodenext`) with compiled output in `dist/`; no HTTP server, CLI app, worker service, container image, or IaC manifests are implemented.
- **Core capabilities (baseline):** config parsing/validation, file parsing (baseline text formats), deterministic chunking, embedding/vector-store abstractions, in-memory vector store, baseline retrieval with optional reranker/authz hooks, grounded prompt/generation helpers with citation/insufficiency/robustness controls, evaluation utilities, observability primitives.
- **External integrations:** none wired by default (no real embedding/LLM provider SDKs, no persistent vector DB, no cloud services).
- **Persistence/state:** in-memory only (`MemoryVectorStore`); no durable storage, backups, or replication.

## Configuration requirements (from actual project needs)
| Area | Requirement | Source/evidence |
|---|---|---|
| Runtime/tooling | Node.js and npm compatible with current baseline (verified with Node `v26.13.1`, npm `12.2.2`); dependencies installed (`npm install`) | `package.json`, lockfile, local runs |
| Build | `npm run build` (`tsc -p tsconfig.json`) to emit `dist/` | `package.json`, `tsconfig.json` |
| Environment/config (when using real providers/stores) | `.env`/env values for `LLM_API_KEY`, `LLM_MODEL`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY` (optional), `EMBEDDING_MODEL`; validated via `parsePipelineConfig`/`loadPipelineConfig` (non-sensitive errors) | `.env.example`, `src/config.ts`, `tests/config.test.ts` |
| Evaluation/benchmarks | Dataset/config artifacts under `data/eval/*`; scripts use `dist/` (`npm run evaluate`, `node scripts/benchmark-smoke.mjs`) | `docs/04-05`, `docs/08`, scripts/tests |
| Authorization (secured use) | Trusted server-side authz context/policy must be supplied to retrieval/generation boundaries; fail closed on unknown/failing policy | `src/retrieve.ts`, `docs/06`, `docs/07`, `tests/security.test.ts` |

**No assumed infrastructure:** AWS/EKS/Qdrant/S3/KMS/managed LLM gateways/monitoring stacks described in enterprise docs are **not configured or required** for the current local baseline.

## Deployment considerations (current)
- **Deployable as:** a Node.js library/package or embedded module within a host application that provides runtime, configuration, provider/store adapters, and API/service boundaries.
- **Not yet deployable as:** a standalone production service (missing server/API layer, persistence, production authn, rate limiting/backpressure, centralized observability/audit, health checks, deployment manifests).
- **Minimum local readiness steps:** install deps → configure env (if integrating real providers) → `npm run build` → `npm run typecheck` / `npm test` / `npm run evaluate` → integrate modules with trusted authz and approved adapters.

## Cost and resource assumptions
| Category | Current evidence | Status |
|---|---|---|
| External service cost (LLM/embedding/vector DB/cloud) | No external paid providers/services used in verified runs; benchmark/eval used deterministic local mocks | **Not measured**; costs depend on future authorized providers/usage and must be tracked before claims |
| Local compute/memory | Local smoke benchmark executed in-process on synthetic n=3 dataset | **Minimal for smoke only**; production resource needs unknown/unvalidated |
| Storage | In-memory store only; no persistent index/object storage | **Not applicable/measured** for durable deployments |
| Engineering/operational overhead | Manual/local verification via npm scripts/tests | Production ops cost unestimated without deployment design |

**Cost controls:** do not incur paid API/cloud usage or transmit restricted data to external services without explicit authorization and configured safeguards (approved model/provider/region, budgets/limits where applicable).

## Evidence-backed performance claims (only measured)
Measured local smoke baseline (2026-11-15, `node scripts/benchmark-smoke.mjs`, synthetic n=3, 50 iterations/150 query-cases, deterministic mocks, in-memory, sequential, Node v26.13.1 linux/x64): retrieval p50/p95/p99 **0.0117/0.0504/0.2505 ms**, generation p50/p95/p99 **0.0039/0.0238/0.0552 ms**, approx throughput **~15,556.5 qps** (wall-loop), failures **0/150**, cost **not measured**.  
**Limitation:** mock/in-memory micro-benchmark only — **not** evidence of real provider/network/storage latency, concurrency, scalability, availability, or production SLO attainment.

## Key failure modes (observed/known)
| Failure mode | Current behavior (verified) | Observability/readiness |
|---|---|---|
| Config missing/invalid | Explicit validation issues / non-sensitive errors (`src/config.ts`) | Detectable at startup boundary; fail closed |
| Unsupported/empty/unreadable/malformed input documents | Explicit parse statuses/issues; batch continues per-file (`src/ingest.ts`) | Reported in results; no silent drop for handled cases |
| Embedding/model-dimension mismatch or invalid vectors | Validation failures (`src/embeddings.ts`, store checks) | Explicit errors; prevents inconsistent indexing/query |
| Retrieval authz missing/misaligned/policy failure (when enforced) | Deny/fail closed on mismatch or evaluator error/throw (`src/retrieve.ts`) | Correct fail-closed behavior; missing authz in unsecured integration remains a risk |
| Provider timeout/error/unavailable/malformed model output/unapproved model | Explicit generation errors or insufficient-context handling; no silent fallback (`src/generate.ts`, `src/resilience.ts`) | Handled; real provider failure patterns/cost/rate limits untested |
| Empty/insufficient evidence or injection in evidence | Insufficient-context response and untrusted-evidence prompt isolation/citation restriction | Baseline safety behavior; not full exfiltration/injection defense |
| Persistence/lifecycle gaps | In-memory state lost on restart; no durable audit/backup/replication | High operational risk for production use |

## Readiness assessment
- **Ready for:** local development, unit/integration-style verification, synthetic smoke evaluation/regression checks, and controlled library integration experiments (with trusted authz and approved config).
- **Not ready for:** production deployment, multi-tenant/customer-facing workloads, regulated/financial data processing claims, SOC 2/GDPR compliance claims, high-scale/HA/DR operation, or reliance on enterprise SLOs without implementation and evidence.
- **Blocking/major gaps:** no service/runtime boundary, no durable/persistent storage, no authenticated identity enforcement, no centralized observability/audit, no real provider/store adapters with egress controls, and unvalidated performance/cost/availability at representative load.

## Recommended next steps
1. Define a concrete deployment target (library-only vs service) and add missing runtime boundary/health checks only if required.
2. Integrate and validate approved embedding/LLM/vector-store adapters with timeouts, retries, budgets, and privacy/egress controls.
3. Run representative, authorized benchmarks (concurrency, real dependencies, realistic datasets) and record results before performance/cost claims.
4. Address security/compliance gaps (`docs/06`, `docs/07`) with implementation and operational evidence prior to any production or regulated use.

## Runbooks (local baseline)

These runbooks cover the operational procedures verified for the current local baseline. They assume a Node.js/TypeScript library deployment with no external infrastructure.

### R-1: Local development start
1. `npm install` — install dependencies.
2. Copy `.env.example` to `.env` and fill values only if integrating real providers/stores (do not commit secrets).
3. `npm run build` — compile TypeScript to `dist/`.
4. `npm run typecheck` — verify types (`tsc --noEmit`).
5. `npm test` — run Vitest suite (143 tests across 22 files as of last verified run).
6. `npm run evaluate` — run synthetic smoke evaluation (deterministic mocks, no paid quota).

### R-2: Health check
- Call `GET /health` on the running HTTP server (created via `createHttpServer`).
- Expected: `200 { status: "ok" }`.
- Any other status or connection failure indicates the service is not running.

### R-3: Readiness check
- Call `GET /ready` on the running HTTP server.
- Expected: `200 { status: "ready" }` when embedding provider, vector store, and language model are all wired.
- `503 { status: "unavailable" }` indicates a missing dependency; check `ServerDependencies` configuration.

### R-4: Query operation
- Call `POST /query` with JSON body `{ "query": "<text>", "topK": 5, "tenantId": "<optional>" }`.
- Expected: `200` with `{ answer, retrieved }`; answer includes `insufficientContext` flag when evidence is absent.
- `400` for validation errors (missing query, invalid topK/tenantId); `401` when authorization policy is configured but no principal supplied; `403` when policy denies access; `502` for provider/store failures; `500` for internal errors.
- Never log or return provider API keys or secret values.

### R-5: Configuration validation failure
- `npm run typecheck` fails: ensure `tsconfig.json`/`src/` are unchanged; run `npm install` and rebuild.
- Config validation errors (`ConfigValidationError`): verify required env vars in `.env`; errors are non-sensitive and exclude secret values.
- `TS18003` (no inputs): ensure `src/` contains TypeScript files; ESM imports use `.js` specifiers (NodeNext).

### R-6: Evaluation/regression check
- `npm run evaluate` — runs synthetic smoke eval against `data/eval/golden-v0.2.0.json` (n=10, deterministic mocks).
- Compare reported metrics (Recall@3, MRR, insufficient-context count) against `data/eval/baselines/golden-v0.2.0.baseline.json`.
- Any metric delta outside expected bounds indicates a regression; investigate before merging.

### R-7: Smoke benchmark
- `node scripts/benchmark-smoke.mjs` — local in-memory/mock micro-benchmark (synthetic n=3 dataset).
- Output includes latency percentiles, throughput, and failure rate; results are environment-sensitive and not production evidence.

### R-8: Ingestion lifecycle (re-index/delete/erasure)
- Use `IngestionLifecycleTracker.shouldReindex()` to detect changed sources before re-ingesting.
- Use `deleteDocument()`/`erasureDocument()` with verification sweep to confirm no residual chunks remain after deletion.
- Check `residualChunkCount` — non-zero indicates incomplete deletion requiring investigation.

### R-9: Incident response (baseline)
- Provider timeout/unavailable: `generateGroundedAnswer` returns explicit error (502 via server), no silent fallback.
- Empty/insufficient evidence: generation returns `insufficientContext: true`, no unsupported claims.
- Cross-tenant access attempt: server returns `403` when authorization policy denies; tenant filtering is server-side only.
- Store delete failure: `IngestionLifecycleTracker.deleteDocument()` returns `ok:false` and does not clear tracking records.

### R-10: What NOT to do (baseline limits)
- Do not run production deployment, multi-tenant workloads, regulated/financial data processing, or SOC 2/GDPR compliance claims without implementation and operational evidence.
- Do not incur paid API/cloud usage or transmit restricted data to external services without explicit authorization.
- Do not treat synthetic mock benchmarks as production performance/SLO evidence.
- Do not rely on in-memory state for durability — all state is lost on restart.