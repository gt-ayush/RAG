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

## Completed Baseline (Phases 0–14)

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

**Total: 14 phases, 54 sub-phases — ALL COMPLETE.**

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
| `npm test` | pass — 27 test files, 197 tests |
| `npm run build` | pass (exit 0) |
| `npm run evaluate` | pass (exit 0) |
| `node scripts/benchmark-smoke.mjs` | pass (exit 0) |
| `node scripts/benchmark-realistic.mjs` | pass (exit 0) |

Re-run these commands after any change; do not carry forward stale results.

---

## Forward Roadmap

**No remaining sub-phases in the baseline.** All 14 phases (54 sub-phases) are complete.

The following phases are planned future work. None are complete — they are targets for future development. When a sub-phase is completed, move it from this section to the completed baseline table above. Phases 15–20 build on the completed baseline (0–14); they do not re-implement work already delivered in phases 10–14.

---

### Phase 15 — Production Service Hardening & Multi-Tenancy

**Goal:** Run `src/server.ts` as a production HTTP service with enforced multi-tenancy, operational safety, and deployable packaging.

#### Sub-phases:

- **15.1 HTTP service hardening**
  - Expose `/health` and `/ready` endpoints on `src/server.ts`; return structured errors and validation failures.
  - Implement graceful shutdown and signal handling (SIGTERM/SIGINT) with in-flight request draining.
  - Load configuration from environment variables with validation at startup; never print secret values.
  - Add request validation, size limits, and tenant-context extraction on every incoming request.
- **15.2 Multi-tenancy enforcement**
  - Enforce server-side tenant isolation at the gateway before any retrieval/generation; fail closed on policy or authorization errors.
  - Add per-tenant rate limiting and token/QPS quotas at the gateway.
  - Add tenant-level access control policies (RBAC/ABAC) with document ACLs; test cross-tenant access (0 leaks).
- **15.3 Deployment packaging**
  - Provide a `Dockerfile`, systemd unit, and Kubernetes deployment manifests for `src/server.ts`.
  - Document required environment variables in `.env.example` and setup docs; keep provider SDK details behind existing interfaces.

**Exit criteria:** Service runs as HTTP with health/readiness endpoints; tenant isolation and fail-closed authorization are tested; deployment/runbook docs match implementation; no secrets logged.

---

### Phase 16 — Security, Privacy & Compliance Evidence

**Goal:** Convert security and privacy design targets into verifiable, tested evidence.

#### Sub-phases:

- **16.1 Audit trail**
  - Implement append-only, integrity-protected audit events for query, retrieval, and generation (identity, filters, candidate IDs/scores, prompt hash, response, model/embedding versions).
  - Add retention policy and redaction of sensitive content from audit records and logs.
- **16.2 Erasure and residency**
  - Implement and verify the erasure cascade across stores (vector index, raw store, policy store) including verification sweeps.
  - Enforce region/tenant residency rules (e.g., EU corpus pinned to eu-west-1; no cross-region writes).
- **16.3 Red-team suites**
  - Expand adversarial testing: cross-tenant access, prompt injection, privilege escalation, secret leakage, malformed input, and deletion behavior.
- **16.4 Evidence pack & gap assessment**
  - Update `docs/07_compliance_gap_assessment.md` with verified controls and remaining gaps; keep SOC 2 Type II / GDPR claims tied to collected evidence only.

**Exit criteria:** Verified controls have test/evidence artifacts; remaining gaps documented; no compliance claim exists without supporting evidence.

---

### Phase 17 — Retrieval Quality & Query Processing

**Goal:** Improve evidence quality with measured, reproducible changes on a versioned dataset.

#### Sub-phases:

- **17.1 Query transformation**
  - Add rewrite/decompose/expand behind an optional hook with explicit latency/token budget and a bypass path.
- **17.2 Sparse/hybrid retrieval and fusion**
  - Add sparse retrieval and rank fusion (e.g., reciprocal-rank fusion) while preserving dense retrieval as the default baseline path.
- **17.3 Reranking and thresholding**
  - Implement the reranker hook contract with a concrete scorer; define an explicit empty-context/refusal threshold behavior.
- **17.4 Representative evaluation**
  - Expand the versioned golden dataset beyond the synthetic smoke set; record dataset version, sample size, metric definitions, and before/after deltas (Recall@K, MRR, nDCG@K, faithfulness).

**Exit criteria:** Every retrieval change is measured on a versioned dataset with reported metrics; dense-only behavior remains available; no quality claim is made without recorded evidence.

---

### Phase 18 — Durable Document Lifecycle & Data Residency

**Goal:** Durable, auditable document lifecycle on top of the verified baseline: source/version traceability, deletion/erasure, and residency.

#### Sub-phases:

- **18.1 Persistent source/version metadata**
  - Preserve source IDs, filenames, page/section details, chunk indexes, and ingestion metadata through indexing; trace chunks back to original sources.
  - Support idempotent re-indexing for reprocessed sources; prevent duplicate indexed records.
- **18.2 Deletion and erasure cascade**
  - Support deletion and GDPR erasure requests with verification sweeps (count = 0) and auditable outcomes written to the audit log.
- **18.3 Residency and cross-region controls**
  - Region-pinned collections; OPA/policy-enforced block on cross-region writes; EU-resident corpora confined to eu-west-1.
- **18.4 Lifecycle runbooks**
  - Define ingestion, erasure, failover, and index-rebuild runbooks; do not run infrastructure, migration, bulk re-index, or destructive commands without explicit confirmation.

**Exit criteria:** Lifecycle operations are tested and observable; residency is enforced; runbooks match the actual implementation.

---

### Phase 19 — Observability, SLOs & Cost Governance

**Goal:** Observable, governed operation under realistic load with evidence-backed SLOs and cost.

#### Sub-phases:

- **19.1 Realistic workload baselines**
  - Measure latency percentiles (P50/P95/P99), throughput, and failure rates per stage with real providers and storage, not mocks; record environment and configuration.
- **19.2 Runtime controls under load**
  - Validate concurrency limits, backpressure, circuit breaking, caching, and alert thresholds with measured numbers; degradation to retrieval-only on overload.
- **19.3 Cost measurement and capacity**
  - Measure cost per query and per ingestion run; per-tenant token/cost attribution; capacity assumptions for realistic corpus sizes (10M+ docs).
- **19.4 Embedding drift and model governance**
  - Embedding-drift monitoring (e.g., KL divergence) with version-pinned models and a documented rollback/re-index process.

**Exit criteria:** Performance and cost claims backed by repeatable measurements on documented configurations; SLOs defined; drift governed with rollback path.

---

### Phase 20 — Release Readiness & Handover

**Goal:** Evidence-backed release readiness: burn-in, residual risks, final evidence pack, and go/no-go gate.

#### Sub-phases:

- **20.1 30-day burn-in**
  - Sustained availability ≥ 99.9%; P95 < 800 ms at target QPS; Recall@10/MRR/nDCG@10 targets; zero critical/high security findings; zero audit-log loss.
- **20.2 Residual risks and deferred work**
  - Produce an explicit risk register and deferred-work list with owners; do not claim production readiness without supporting evidence.
- **20.3 Final evidence pack and go/no-go**
  - Aggregate all evidence from completed phases (compliance gap assessment, SLO results, security findings, audit results, cost metrics, drift detection, model governance, alert evaluations) into a single evidence pack.
  - Run the go/no-go gate across all burn-in metrics: availability ≥ 99.9%, P95 latency < 800 ms, error rate ≤ 1%, Recall@10 ≥ 0.85, zero audit-log loss, zero critical/high security findings.
  - Evaluate drift detection results and model governance decisions as part of the go/no-go criteria.
  - Evaluate alert evaluations from runtime controls; any firing critical alert blocks go.
  - Verify SOC 2 Type II (CC4/CC6/CC7) and GDPR evidence completeness.
  - Produce a final go/no-go decision with confidence score, blocking issues, and warnings.
  - Document residual risks and deferred work items.
  - Emit structured evidence pack report for auditor review.
- **20.4 Handover report**
  - Repeat the Phase 9.3 handover with real evidence, updated docs, changed files, commands run, results, known limitations, and follow-up work.

**Exit criteria:** Release readiness evidenced for the full burn-in window; handover distinguishes verified capability from remaining gaps.

---

## Dependencies and Ordering

- **Phase 15** is the default next increment (smallest useful slice: one service at a time).
- **Phase 16** benefits from real providers/stores for meaningful measurement; it may proceed with mocks only if labelled as synthetic.
- **Phase 17** requires Phase 15/10 store/provider decisions (persistent store semantics, tenancy fields).
- **Phase 18** requires Phase 15 runtime boundaries for meaningful isolation/audit evidence.
- **Phase 19** requires Phases 15–18 for realistic measurement.
- **Phase 20** requires Phases 15–19 for a full burn-in window.

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
