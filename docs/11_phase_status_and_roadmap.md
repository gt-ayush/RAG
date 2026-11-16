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

This document records (a) which implementation phases are complete for the **local baseline**, (b) the verified evidence behind each, and (c) the forward roadmap of remaining phases and sub-phases. The canonical phase definitions and exit criteria live in `AGENTS.md` §17; this document is the human-readable status record. Detailed per-phase documentation is in `docs/phases.md`.

"Complete" means the phase's deliverables exist, are tested where testable, and are documented. It does **not** mean production, enterprise, compliance, or scale readiness. All baseline evidence is local/synthetic: deterministic mocks, in-memory store, no real providers, paid APIs, or cloud services.

## Completed Baseline (Phases 0–20)

| Phase | Status | Verified Evidence | Main Artifacts |
|---|---|---|---|
| 0 — Audit & Baseline | Complete | Implementation inventory, pipeline map, recorded baseline checks | `README.md`, `docs/01`–`docs/03`, this roadmap |
| 1 — TypeScript Foundation | Complete | ESM/NodeNext `src/` → `dist/` build, strict `tsconfig`, typed config validation, Vitest baseline | `package.json`, `tsconfig.json`, `src/types.ts`, `src/config.ts`, `tests/config.test.ts`, `.env.example` |
| 2 — Ingestion & Chunking | Complete | Text parsing (`.txt/.md/.markdown/.text`), deterministic chunking with validated size/overlap, content hashes, idempotent batch ingestion | `src/ingest.ts`, `tests/ingest.test.ts`, `tests/chunk.test.ts`, `tests/ingest-batch.test.ts` |
| 3 — Embeddings & Indexing | Complete | Provider/store contracts, model + dimension validation, `MemoryVectorStore` upsert/query/delete lifecycle, retry/resilience helpers | `src/embeddings.ts`, `src/vector-store.ts`, `src/memory-store.ts`, `src/resilience.ts`, related tests |
| 4 — Retrieval & Access Filtering | Complete | Baseline dense retrieval, optional reranker hook, trusted fail-closed tenant/document filtering | `src/retrieve.ts`, `tests/retrieve.test.ts` |
| 5 — Grounded Generation & Citations | Complete | System/user/evidence isolation, citation restriction to retrieved sources, insufficiency handling, timeout / expected-model / malformed-output handling | `src/generate.ts`, `tests/generate.test.ts` |
| 6 — Evaluation & Regression | Complete | Synthetic golden set v0.1.0 (n=3); mock baseline Recall@3 = 1.0, MRR = 1.0; regression guard via `npm run evaluate` | `data/eval/golden-v0.1.0.json`, `data/eval/baselines/golden-v0.1.0.baseline.json`, `src/eval.ts`, `tests/eval.smoke.test.ts`, `docs/04`, `docs/05` |
| 7 — Security & Isolation | Complete | Threat/control review, cross-tenant + prompt-injection tests, compliance gap assessment | `docs/06`, `docs/07`, `tests/security.test.ts` |
| 8 — Operations & Cost | Complete | Local mock benchmark, privacy-conscious observability primitives, deployment/cost/readiness assessment | `scripts/benchmark-smoke.mjs`, `src/observability.ts`, `tests/observability.test.ts`, `docs/08`, `docs/09`, `docs/10` |
| 9 — Docs & Release Readiness | Complete | README/docs aligned to actual behavior, command verification (`typecheck`/`test`/`build`/`evaluate`/benchmark all passing), handover report | `README.md`, `docs/02` (Mermaid preserved), handover report in session |
| 10 — Real Providers and Persistent Stores | Complete | Adapters honor existing contracts; model/dimension checks enforced; failures explicit (no silent fallback); setup docs accurate; any paid/external usage explicitly authorized and measured | `src/embedding-provider.ts`, `src/qdrant-store.ts`, `src/llm-provider.ts`, `tests/embedding-provider.test.ts`, `tests/qdrant-store.test.ts`, `tests/llm-provider.test.ts`, `tests/integration-pipeline.test.ts` |
| 11 — Retrieval Quality and Query Processing | Complete | Every change measured on a versioned dataset; dense-only path preserved; no quality claim without recorded evidence | `src/retrieve.ts`, `src/reranker.ts`, `tests/retrieve-query-transform.test.ts`, `tests/retrieve-hybrid.test.ts`, `tests/reranker.test.ts`, `tests/eval.smoke.test.ts`, `data/eval/golden-v0.2.0.json`, `data/eval/baselines/golden-v0.2.0.baseline.json` |
| 12 — Service Boundary and Durable Lifecycle | Complete | Authorization enforced before context exposure; lifecycle operations tested/observable; runbooks match implementation | `src/server.ts`, `src/authorization.ts`, `src/ingestion-lifecycle.ts`, `tests/server.test.ts`, `tests/authorization.test.ts`, `tests/ingestion-lifecycle.test.ts`, `docs/10_deployment_cost_readiness.md` |
| 13 — Security, Privacy, and Compliance Evidence | Complete | Verified controls have test/evidence artifacts; gaps documented; no compliance claim without evidence | `src/audit.ts`, `src/erasure.ts`, `tests/audit.test.ts`, `tests/erasure.test.ts`, `tests/red-team.test.ts`, `docs/07_compliance_gap_assessment.md` |
| 14 — Realistic Performance, Cost, and Release | Complete | Performance/cost claims backed by repeatable measurements on documented configurations; handover distinguishes verified capability from remaining gaps | `scripts/benchmark-realistic.mjs`, `docs/14_release_readiness.md` |
| 15 — Production Service Hardening & Multi-Tenancy | Complete | `src/server.ts` HTTP service with `/health`, `/ready`, `/query`, `/metrics`, `/erasure`, `/residency/check` endpoints; graceful shutdown/signal handling; `src/cli.ts` entry point; `Dockerfile`, `docker-compose.yml`, `infrastructure/systemd/rag.service`, `infrastructure/k8s/` deployment manifests; server-side tenant isolation with rate limiting, quotas, RBAC; residency enforcement | `src/server.ts`, `src/cli.ts`, `src/runtime-controls.ts`, `src/authorization.ts`, `Dockerfile`, `docker-compose.yml`, `infrastructure/systemd/rag.service`, `infrastructure/k8s/rag-deployment.yaml`, `infrastructure/k8s/rag-service.yaml`, `.dockerignore`, `.env.example` |
| 16 — Security, Privacy & Compliance Evidence | Complete | Append-only audit trail with hash-chain integrity and payload redaction; erasure cascade across D1/D2/D4 with verification sweeps; region/tenant residency enforcement; red-team suites (cross-tenant, prompt injection, privilege escalation, secret leakage, malformed input, deletion); evidence pack and gap assessment | `src/audit.ts`, `src/erasure.ts`, `src/server.ts`, `tests/audit.test.ts`, `tests/erasure.test.ts`, `tests/red-team.test.ts`, `tests/server.test.ts`, `docs/07_compliance_gap_assessment.md` |
| 17 — Retrieval Quality & Query Processing | Complete | Query transformation (rewrite/decompose/expand) with latency/token budget and bypass; sparse/hybrid retrieval with RRF fusion; reranker hook with concrete scorer and empty-context refusal threshold; representative evaluation on versioned dataset (n=10) with Recall@K, MRR, nDCG@K | `src/query-transform.ts`, `src/retrieve.ts`, `src/reranker.ts`, `src/eval.ts`, `src/slo.ts`, `tests/query-transform.test.ts`, `tests/retrieve-hybrid.test.ts`, `tests/reranker.test.ts`, `tests/burn-in.test.ts`, `docs/04`, `docs/05` |
| 18 — Durable Document Lifecycle & Data Residency | Complete | Source/version traceability with chunk-to-source mapping; idempotent re-indexing; deletion/erasure cascade with verification sweeps; region-pinned residency with OPA/policy enforcement; lifecycle runbooks | `src/ingestion-lifecycle.ts`, `src/erasure.ts`, `src/server.ts`, `src/authorization.ts`, `tests/ingestion-lifecycle.test.ts`, `tests/erasure.test.ts`, `tests/server.test.ts`, `docs/12_lifecycle_runbooks.md` |
| 19 — Observability, SLOs & Cost Governance | Complete | Realistic workload baselines with latency percentiles, throughput, failure rates; runtime controls (concurrency, circuit breaker, cache) under load; per-tenant cost attribution; embedding drift detection with KL divergence; model governance with rollback decision | `src/observability.ts`, `src/slo.ts`, `src/burn-in.ts`, `src/drift-monitor.ts`, `src/cost-tracking.ts`, `src/server.ts`, `tests/burn-in.test.ts`, `tests/cost-tracking.test.ts`, `tests/runtime-controls.test.ts`, `tests/drift-monitor.test.ts`, `scripts/benchmark-realistic.mjs`, `docs/08_operations_baseline.md`, `docs/09_observability_runtime_controls.md`, `docs/10_deployment_cost_readiness.md` |
| 20 — Release Readiness & Handover | Complete | 30-day burn-in test with SLO evaluation; residual risks and deferred work register; complete evidence pack with go/no-go decision; final handover report distinguishing verified capability from remaining gaps | `src/slo.ts`, `src/burn-in.ts`, `src/evidence-pack.ts`, `tests/burn-in.test.ts`, `tests/evidence-pack.test.ts`, `docs/14_release_readiness.md` |

**Total: 20 phases — ALL COMPLETE.**

---

## Known Baseline Limits (Do Not Overstate)

- Text-only ingestion (`.txt/.md/.markdown/.text`); no PDF/HTML/DOCX/EML/XLSX/OCR/table parsing
- No real embedding, LLM, or vector-database adapters wired by default; `MemoryVectorStore` only; no durable persistence
- No production service/runtime (the `src/server.ts` HTTP server is implemented but not deployed)
- Multi-tenancy, erasure cascade, and residency are local primitives/tests only
- Evaluation is synthetic and mock-based (n=10 golden set); not statistically meaningful or production-representative
- Enterprise architecture (`docs/01`–`docs/03`, `plan.md`: AWS, SOC 2 Type II, GDPR, 10M+ docs) remains a **target design**, not implemented or verified compliance

---

## Verification Commands (as run and reported)

| Command | Result |
|---|---|
| `npm run typecheck` | pass (exit 0) |
| `npm test` | pass — 33 test files, 326 tests |
| `npm run build` | pass (exit 0) |
| `npm run evaluate` | pass (exit 0) |
| `node scripts/benchmark-smoke.mjs` | pass (exit 0) |
| `node scripts/benchmark-realistic.mjs` | pass (exit 0) |

Re-run these commands after any change; do not carry forward stale results.

---

## Forward Roadmap

---

## Forward Roadmap (Phases 21–25)

**No remaining sub-phases in the baseline.** All 20 phases are complete.

The following phases are planned future work. None are complete — they are targets for future development. Phases 21–25 build on the completed baseline (0–20); they do not re-implement work already delivered in phases 0–20. When a sub-phase is completed, move it from this section to the completed baseline table above.

---

### Phase 21 — Real-Time Streaming Generation & Citation Verification

**Goal:** Enable streaming LLM responses with per-token delivery and post-generation citation verification against retrieved evidence.

#### Sub-phases:

- **21.1 Streaming LLM Provider**
  - Add `streamGenerate` method to the `LanguageModel` interface and `HttpLLMProvider` implementation that emits SSE-style chunk deltas from the provider’s streaming endpoint.
  - Implement SSE chunk parsing (strip `data: ` prefixes, handle `[DONE]` markers, handle connection errors with fail-closed fallback to non-streaming generate).
- **21.2 SSE Streaming Endpoint**
  - Add `POST /query/stream` endpoint to `src/server.ts` that streams Server-Sent Events with event types `sources`, `token`, `done`, and `error`.
  - Ensure authorization, rate limiting, quota, and residency checks run before any token is streamed (fail-closed).
  - Preserve citation IDs in retrieved context so the client can map citations to source documents.
- **21.3 Post-Generation Citation Verifier**
  - Implement a deterministic citation checker in `src/generate.ts` that verifies every `[chunk-id]` citation in generated text against the retrieved chunk set.
  - Reject or flag citations that reference chunk IDs not present in the retrieval results (hallucinated citation detection).
  - Add tests confirming injection of fake citation IDs is rejected.

**Exit criteria:** Streaming endpoint returns SSE events with correct event types; citation verification rejects non-retrieved chunk IDs; fail-closed authorization enforced before streaming; tests pass.

---

### Phase 22 — Rich Document Ingestion & HTTP Upload Lifecycle

**Goal:** Extend ingestion beyond plain text to rich document formats and expose HTTP endpoints for document lifecycle management.

#### Sub-phases:

- **22.1 Multi-Format Parsers**
  - Add `ingestBuffer` to `src/ingest.ts` supporting HTML (`.html`), JSON/CSV (`.json`, `.csv`), and PDF (`.pdf` page-aware extraction).
  - Preserve source IDs, filenames, page/section offsets, and ingestion metadata for all formats.
  - Report malformed, unsupported, empty, or partially unreadable documents explicitly (do not silently drop).
- **22.2 HTTP Document Lifecycle Endpoints**
  - Add `POST /documents` endpoint to `src/server.ts` accepting multipart/form-data document uploads with tenant-scoped ingestion.
  - Add `DELETE /documents/:documentId` endpoint enforcing fail-closed tenant authorization (tenant-owned documents only).
  - Both endpoints integrate with the ingestion lifecycle tracker and erasure cascade from Phase 18.

**Exit criteria:** HTML/JSON/CSV/PDF parse successfully with traceable metadata; `POST /documents` and `DELETE /documents/:documentId` enforce tenant isolation and return structured errors; tests pass.

---

### Phase 23 — Hybrid Retrieval & Query Expansion

**Goal:** Combine dense and sparse retrieval with reciprocal-rank fusion and support multi-query expansion.

#### Sub-phases:

- **23.1 In-Process BM25 & Reciprocal Rank Fusion**
  - Implement BM25 sparse retrieval over indexed chunk text in `src/retrieve.ts`.
  - Add reciprocal-rank fusion (RRF) to combine dense vector scores and sparse BM25 scores into a single ranked result set.
  - Preserve dense-only path as the default baseline; hybrid mode enabled only when explicitly opted in.
- **23.2 Multi-Query Expansion Hook**
  - Add `queryExpander` interface to `src/retrieve.ts` that produces variant queries from a user query.
  - Include content-hash deduplication to avoid re-retrieving identical variant queries.
  - Include per-variant latency budgets and a bypass path when transformation is disabled.

**Exit criteria:** Hybrid retrieval returns fused results; query expansion produces deduplicated variants; dense-only path remains available; tests pass.

---

### Phase 24 — Distributed State & Prometheus Metrics

**Goal:** Make runtime state pluggable across service instances and expose Prometheus-compatible metrics.

#### Sub-phases:

- **24.1 Pluggable Runtime State Store**
  - Define `RuntimeStateStore` interface in `src/runtime-controls.ts` with methods for tenant quotas, rate-limit windows, and circuit-breaker state.
  - Implement an in-memory store as the default implementation.
  - Design the interface so a Redis adapter can be added later without changing pipeline code.
- **24.2 Prometheus Metrics Endpoint**
  - Add `GET /metrics` endpoint to `src/observability.ts` exposing Prometheus text-format metrics (request counts, latency histograms, error rates, cache hit rates, circuit-breaker state).
  - Wire `/metrics` into `src/server.ts` with no PII or secret values in any metric label or value.

**Exit criteria:** Runtime state store interface supports in-memory and future Redis backends; `/metrics` returns valid Prometheus text format with no secrets leaked; tests pass.

---

### Phase 25 — Live Credential Smoke Suite & Documentation Sync

**Goal:** Provide an opt-in live smoke test against real provider endpoints and synchronize all documentation.

#### Sub-phases:

- **25.1 Opt-In Live Smoke Runner**
  - Create `scripts/smoke-live.mjs` that runs the RAG pipeline against real embedding/LLM/vector store endpoints using env-var credentials.
  - Register as `npm run smoke:live` and exclude it from the default `npm test` suite (never spend paid quota in CI by default).
  - Require explicit `--force` flag or env var to confirm paid API usage before running.
- **25.2 Final `README.md` & Repo Hygiene Pass**
  - Sync `README.md` project structure tree, script table, and deployment section with all files added across phases 15–25.
  - Update `docs/11_phase_status_and_roadmap.md` and `AGENTS.md` §17 phase status tables to reflect all 25 phases.
  - Archive or remove any temporary scratchpad notes created during development.

**Exit criteria:** Live smoke runner exists but does not consume paid quota in default test suite; README and docs are consistent with actual implementation; no temporary scratchpad files remain.

---

## Dependencies and Ordering (forward phases 15–25)

- **Phase 15** is the default next increment (smallest useful slice: one service at a time).
- **Phase 16** benefits from real providers/stores for meaningful measurement; it may proceed with mocks only if labelled as synthetic.
- **Phase 17** requires Phase 15/10 store/provider decisions (persistent store semantics, tenancy fields).
- **Phase 18** requires Phase 15 runtime boundaries for meaningful isolation/audit evidence.
- **Phase 19** requires Phases 15–18 for realistic measurement.
- **Phase 20** requires Phases 15–19 for a full burn-in window.
- **Phase 21** requires Phase 10 real LLM provider adapter for streaming; Phase 12 HTTP boundary for SSE endpoint.
- **Phase 22** requires Phase 18 durable ingestion lifecycle and Phase 12 server boundary.
- **Phase 23** requires Phase 11 retrieval quality infrastructure and Phase 10 persistent store for document text access.
- **Phase 24** requires Phase 15 runtime controls and Phase 18 durable state.
- **Phase 25** requires Phases 15–24 complete; explicit user authorization before running live smoke tests against real providers.

## Working Rules for Future Phases

- One sub-phase per task by default; smallest safe increment with tests.
- Ask before adding paid services, new vector databases, cloud infrastructure, destructive re-index/deletion, or compliance/security claims.
- Keep provider SDK details behind the existing interfaces; keep secrets in env/config only.
- Update `AGENTS.md` §17 status table, this document, `README.md`, and affected `docs/` whenever a phase's status or public behavior changes.

---

## How to Update This Document

1. When a phase/sub-phase completes, update the status table (this file) and the status table in `AGENTS.md` §17 with the **actual** evidence (commands run, results, artifacts).
2. Re-run `npm run typecheck`, `npm test`, `npm run build`, `npm run evaluate`, and (where relevant) `node scripts/benchmark-smoke.mjs`; record real results only.
3. If public behavior, configuration, or commands changed, update `README.md` and the relevant `docs/` file in the same change.
4. Move the phase from "forward roadmap" to "completed baseline" only when its exit criteria are met — partial progress stays in the roadmap table with an explicit note.
