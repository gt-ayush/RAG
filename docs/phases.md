---
title: "Phase Status and Development Phases"
artifact_id: RAG-PLAN-005
package_part: "roadmap"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase Status and Development Phases

## Scope

This document records the complete status of all 14 phases (54 sub-phases) for the RAG repository baseline. "Complete" means the phase's deliverables exist, are tested where testable, and are documented. It does **not** mean production, enterprise, compliance, or scale readiness. All baseline evidence is local/synthetic: deterministic mocks, in-memory store, no real providers, paid APIs, or cloud services.

## Completed Baseline (Phases 0–14)

| Phase | Status | Verified Evidence | Main Artifacts |
|---|---|---|---|
| 0 — Audit & Baseline | Complete | Implementation inventory, pipeline map, recorded baseline checks | `README.md`, `docs/01`–`docs/03` (target docs), `docs/11_phase_status_and_roadmap.md` |
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

**Total: 14 phases, 54 sub-phases — all complete.**

---

## Phase 0 — Repository Audit and Baseline

**Goal:** Establish what exists before changing the system.

### Sub-phases:

- **0.1 Discovery & inventory**: Read `README.md`, `package.json`, `tsconfig.json`, `plan.md`, relevant `docs/`, source files, tests, and environment examples. Record existing scripts, dependencies, providers, data stores, and required environment variables without exposing secrets. Verify that documented paths, commands, and dependencies actually exist in the repo.
- **0.2 Pipeline & behavior mapping**: Map the actual ingestion, chunking, embedding, indexing, retrieval, generation, citation, configuration, and evaluation paths. Identify implemented behavior versus placeholders, planned features, and documentation-only claims. Note preservation boundaries (what must remain working) and high-risk areas.
- **0.3 Baseline verification & backlog**: Run the narrowest safe existing checks (e.g., type-check/build/test scripts that are present) and record the baseline. Capture known failures, gaps, and operational risks without inventing results or installing dependencies without authorization. Produce a prioritized, phase-aligned backlog for subsequent work.

**Exit criteria:** A concise implementation inventory, known gaps and risks, verified available commands with recorded baseline results, and a proposed prioritized backlog.

---

## Phase 1 — Reliable TypeScript Foundation

**Goal:** Make the existing application predictable to develop and verify.

### Sub-phases:

- **1.1 Tooling & project configuration**: Confirm TypeScript configuration and current build/test/lint/type-check scripts in `package.json` and config files. Resolve configuration inconsistencies that block verification, without weakening strictness or changing architecture.
- **1.2 Shared types & boundaries**: Define or reuse shared types for documents, chunks, metadata, embeddings, retrieval results, citations, configuration, and pipeline responses. Validate untrusted data at system boundaries (environment variables, document metadata, vector-store responses, LLM responses) using precise types or `unknown` with validation.
- **1.3 Errors, config, and baseline tests**: Standardize error handling and configuration validation without leaking secrets. Add focused tests around existing behavior and fix high-impact foundation issues before adding features.

**Exit criteria:** Existing functionality is covered by relevant tests, boundary failures are handled intentionally, and the available type-check/build commands have been run and their results reported.

---

## Phase 2 — Document Ingestion and Chunking

**Goal:** Turn source documents into traceable, indexable chunks.

### Sub-phases:

- **2.1 Source loading & parsing**: Verify supported file formats and parsing behavior before extending them. Handle malformed, unsupported, empty, or partially unreadable documents explicitly (report, do not silently drop). Keep parsing observable without logging sensitive content.
- **2.2 Chunking strategy & metadata**: Preserve source IDs, filenames or source references, page/section details where available, chunk indexes, and ingestion metadata. Validate chunk size and overlap settings; ensure chunk boundaries are deterministic and traceable.
- **2.3 Idempotency & ingestion tests**: Make repeated ingestion behavior explicit and prevent duplicate indexed records where supported. Test boundaries, empty inputs, malformed documents, partial parsing failures, and repeatability.

**Exit criteria:** Supported inputs produce deterministic, traceable chunks; invalid or partially unreadable inputs are reported; and ingestion/chunking tests pass.

---

## Phase 3 — Embeddings and Indexing

**Goal:** Store chunks and vectors consistently and safely.

### Sub-phases:

- **3.1 Provider & store alignment**: Verify the embedding provider, vector store, schema, and indexing implementation already in use. Keep document and query embedding model/version and dimensions compatible; detect mismatches explicitly.
- **3.2 Indexing, metadata, and lifecycle**: Preserve chunk/source metadata through indexing and define re-ingestion and deletion behavior. Ensure indexed records can be traced back to original sources and chunks.
- **3.3 Resilience & verification**: Handle provider errors, rate limits, partial failures, and retries safely where applicable. Test repeatability, failure modes, metadata fidelity, and model/dimension checks. Do not introduce a new vector database or paid service without a clear need and authorization.

**Exit criteria:** Chunks can be indexed and traced back to sources; model/dimension compatibility is checked; and repeatability, failure, and metadata tests pass.

---

## Phase 4 — Retrieval Quality and Access Filtering

**Goal:** Retrieve relevant evidence while enforcing authorization.

### Sub-phases:

- **4.1 Baseline retrieval & traceability**: Establish a baseline for current retrieval behavior and test top-K limits, empty results, ranking, metadata filters, and source traceability. Preserve the current vector-store abstraction and provider support.
- **4.2 Retrieval strategies & ranking improvements**: Add or improve sparse/hybrid retrieval, rank fusion, or reranking only when justified by the codebase and measured need. Treat Qdrant, BM25, reciprocal-rank fusion, and cross-encoder reranking as targets unless repository evidence confirms implementation.
- **4.3 Authorization & measured quality**: Apply tenant, user, and document permissions on the trusted server side before retrieved content reaches generation. Evaluate retrieval quality with measured results when claims are made; never fabricate metrics.

**Exit criteria:** Retrieval returns traceable results, authorization filters are enforced and tested, and any quality claims are supported by measured evaluation results.

---

## Phase 5 — Grounded Generation and Citations

**Goal:** Produce answers supported by retrieved evidence.

### Sub-phases:

- **5.1 Prompt assembly & context isolation**: Keep system instructions, user questions, and retrieved documents clearly separated in prompts. Treat retrieved text as untrusted evidence, never as instructions that can override system policy or access controls.
- **5.2 Grounding, citations, and insufficiency handling**: Preserve source references through generation and produce citations only from real retrieved sources. Define behavior for insufficient, conflicting, or irrelevant evidence; avoid unsupported claims.
- **5.3 Provider robustness & safety tests**: Handle timeouts, provider failures, rate limits, malformed model output, and unavailable models. Do not silently switch to an unapproved model or send restricted data to another provider. Test grounded answers, citation traceability, insufficient-context behavior, prompt injection, and provider failures.

**Exit criteria:** Tests cover grounded answers, citation traceability, insufficient-context behavior, prompt injection, and provider failures.

---

## Phase 6 — Evaluation and Regression Protection

**Goal:** Measure retrieval and answer quality before and after changes.

### Sub-phases:

- **6.1 Evaluation dataset & methodology**: Use a versioned golden question-answer/evidence set when available; document its source and limitations. Record dataset version, sample size, metric definitions, model/configuration, and evaluation method.
- **6.2 Metrics & measurement**: Evaluate retrieval and generation separately where practical. Use relevant metrics such as Recall@K, MRR, nDCG@K, faithfulness, answer relevance, context precision/recall, latency percentiles, and cost per query only when actually measured. Never fabricate benchmarks or imply a small test set proves production readiness.
- **6.3 Regression baselines & reporting**: Add regression tests for known failures and compare changes against a baseline. Report results honestly with sufficient context to reproduce or interpret them.

**Exit criteria:** A repeatable evaluation process exists, results are reported honestly, and important regressions are detectable.

---

## Phase 7 — Security, Privacy, and Tenant Isolation

**Goal:** Verify security controls in implementation, not only in documentation.

### Sub-phases:

- **7.1 Threat & control review**: Review authentication and authorization paths, server-side tenant/document filtering, secret handling, logging, retention, deletion, and provider data flows. Identify trust boundaries and where fail-closed behavior is required.
- **7.2 Security & isolation testing**: Test cross-tenant access attempts, prompt injection, sensitive-data leakage, malformed inputs, and deletion behavior where applicable. Fail closed when authorization or policy evaluation fails; minimize sensitive information in logs and test fixtures.
- **7.3 Compliance gap assessment & safe operations**: Treat GDPR erasure, immutable audit trails, regional residency, SOC 2 Type II, and production controls as unverified until supported by implementation and operational evidence. Obtain confirmation before destructive deletion, bulk re-indexing, infrastructure changes, or other high-impact operations. Document verified controls separately from remaining gaps.

**Exit criteria:** Relevant security tests and a documented gap assessment exist; claims distinguish verified controls from remaining operational or compliance work.

---

## Phase 8 — Operations, Performance, and Cost

**Goal:** Prepare for observable and responsible operation at the intended scale.

### Sub-phases:

- **8.1 Workload, baselines, and SLO targets**: Establish realistic workload assumptions and baseline latency, throughput, failure rate, and cost where measurable. Treat production SLOs, multi-region deployment, large-scale operation, and disaster recovery as targets until validated.
- **8.2 Observability & runtime controls**: Add structured, privacy-conscious logs and useful operational metrics consistent with existing architecture. Review timeouts, retries, concurrency, rate limits, backpressure, caching, and resource cleanup where relevant.
- **8.3 Deployment, cost, and readiness**: Define configuration and deployment requirements from actual project needs; do not assume cloud infrastructure exists. Document operational risks, resource assumptions, and key failure modes with evidence-backed performance claims.

**Exit criteria:** Operational risks and resource assumptions are documented, key failure modes are observable, and performance claims are backed by repeatable measurements.

---

## Phase 9 — Documentation and Release Readiness

**Goal:** Ensure documentation matches the behavior that was actually verified.

### Sub-phases:

- **9.1 Documentation & diagram alignment**: Update `README.md`, relevant `docs/`, setup instructions, environment examples, architecture diagrams, and troubleshooting guidance when behavior changes. Preserve valid Mermaid syntax and distinguish current capabilities from plans and assumptions.
- **9.2 Verification & command accuracy**: Verify documented commands against `package.json` and available tooling. Run the relevant type-check and tests, then other available checks appropriate to the change.
- **9.3 Handover & readiness reporting**: Summarize changed files, commands actually run, results, known limitations, and follow-up work. Do not claim production readiness, SOC 2 Type II compliance, GDPR compliance, or enterprise-scale capability without appropriate evidence.

**Exit criteria:** Setup and usage documentation is accurate, relevant checks and evaluations are reported, and outstanding risks are clearly stated.

---

## Phase 10 — Real Providers and Persistent Stores

**Goal:** Replace the mock/in-memory baseline with real, configured integrations behind the existing interfaces, without changing the pipeline architecture.

### Sub-phases:

- **10.1 Embedding provider adapter**: Implement the existing `EmbeddingProvider` contract for one explicitly chosen provider; keep provider SDK details inside the adapter. Enforce model/version pinning and dimension compatibility with the store; reject mismatches instead of silently re-embedding. Add timeout, retry, and rate-limit handling using existing resilience helpers; surface actionable, non-secret errors.
- **10.2 Vector store adapter**: Implement the existing `VectorStore` contract against one explicitly chosen persistent store; preserve chunk/source metadata and tenant fields. Define upsert/re-index/delete semantics and idempotency for reprocessed sources. Do not add a vector database, cloud service, or paid plan without explicit user authorization and a documented need.
- **10.3 LLM provider / gateway adapter**: Implement the existing `LanguageModel` contract via a gateway-style abstraction; keep vendor SDK calls out of pipeline modules. Preserve grounding/citation rules, expected-model enforcement, timeout handling, and "no silent model fallback" behavior. Keep secrets in environment/config only and redact sensitive content from logs and errors.
- **10.4 Integration tests & setup docs**: Add contract-level tests using fixtures or recorded responses; do not spend paid API quota inside the default test suite. Document required environment variables, setup steps, and failure modes; keep `README.md` and `.env.example` accurate.

**Exit criteria:** Adapters implement the existing interfaces; configuration and model/dimension checks are enforced and tested; failures are handled explicitly without silent fallbacks; setup documentation is accurate; any paid/external usage is recorded as authorized and measured.

---

## Phase 11 — Retrieval Quality and Query Processing

**Goal:** Improve evidence quality with measured, reproducible changes.

### Sub-phases:

- **11.1 Query transformation**: Add rewrite/decompose/expand capabilities behind an optional hook with explicit latency/token budget and a bypass path.
- **11.2 Sparse/hybrid retrieval and fusion**: Add sparse retrieval and rank fusion (e.g., reciprocal-rank fusion) while preserving dense retrieval as the default baseline path.
- **11.3 Reranking and thresholding**: Implement the existing reranker hook contract with a concrete scorer; define an explicit empty-context/refusal threshold behavior.
- **11.4 Representative evaluation**: Expand the versioned golden dataset beyond the n=3 synthetic smoke set; record dataset version, sample size, metric definitions, and before/after deltas.

**Exit criteria:** Every retrieval change is measured on a versioned dataset with reported metrics; dense-only behavior remains available; no quality claim is made without recorded evidence.

---

## Phase 12 — Service Boundary and Durable Lifecycle

**Goal:** Introduce a real runtime boundary and durable document lifecycle on top of the verified baseline.

### Sub-phases:

- **12.1 API/runtime boundary**: Add the smallest service surface the project actually needs, with request validation, structured errors, and health/readiness endpoints.
- **12.2 Server-side authorization**: Enforce tenant/document authorization on the trusted server side before retrieval results reach generation; fail closed on policy errors and test cross-tenant access.
- **12.3 Durable ingestion lifecycle**: Persist source/version metadata, support re-index and deletion (including erasure requests) with verification sweeps and auditable outcomes.
- **12.4 Deployment & runbooks**: Define configuration, deployment, and operational runbooks consistent with real infrastructure; do not run infrastructure, migration, bulk re-index, or destructive commands without explicit confirmation.

**Exit criteria:** The runtime enforces authorization before context exposure; lifecycle operations are tested and observable; deployment/runbook docs match the actual implementation.

---

## Phase 13 — Security, Privacy, and Compliance Evidence

**Goal:** Convert design targets into verifiable evidence.

### Sub-phases:

- **13.1 Audit trail**: Implement append-only, integrity-protected query/retrieval/generation audit events with retention policy and redaction of sensitive content.
- **13.2 Erasure and residency**: Implement and verify the erasure cascade across stores (including verification sweeps) and enforce region/tenant residency rules.
- **13.3 Red-team suites**: Expand adversarial testing: cross-tenant access, prompt injection, privilege escalation, secret leakage, malformed input, and deletion behavior.
- **13.4 Evidence pack & gap assessment**: Update `docs/07_compliance_gap_assessment.md` with verified controls and remaining gaps; keep SOC 2 Type II / GDPR claims tied to collected evidence only.

**Exit criteria:** Verified controls have test/evidence artifacts; remaining gaps are documented; no compliance claim exists without supporting evidence.

---

## Phase 14 — Realistic Performance, Cost, and Release

**Goal:** Validate behavior under realistic workloads and produce evidence-backed release readiness.

### Sub-phases:

- **14.1 Realistic workload baselines**: Measure latency percentiles, throughput, and failure rates with real providers and storage, not mocks; record environment and configuration.
- **14.2 Runtime controls under load**: Validate concurrency limits, backpressure, circuit breaking, caching, and alert thresholds with measured numbers.
- **14.3 Cost measurement & capacity**: Measure cost per query/ingestion run and produce capacity assumptions for realistic corpus sizes.
- **14.4 Release readiness & handover**: Repeat the Phase 9.3 handover with real evidence, updated docs, and an explicit list of residual risks and deferred work.

**Exit criteria:** Performance and cost claims are backed by repeatable measurements on documented configurations; the handover distinguishes verified capability from remaining gaps.

---

## Dependencies and Ordering (baseline phases 0–14)

- **Phase 10** is the default next increment (smallest useful slice: one adapter at a time).
- **Phase 11** benefits from real providers/stores for meaningful measurement; it may proceed with mocks only if labelled as synthetic.
- **Phase 12** requires Phase 10 store/provider decisions (persistent store semantics, tenancy fields).
- **Phase 13** requires Phase 12 runtime boundaries for meaningful isolation/audit evidence.
- **Phase 14** requires Phases 10–12 for realistic measurement.

### Working Rules for Future Phases

- One sub-phase per task by default; smallest safe increment with tests.
- Ask before adding paid services, new vector databases, cloud infrastructure, destructive re-index/deletion, or compliance/security claims.
- Keep provider SDK details behind the existing interfaces; keep secrets in env/config only.
- Update `AGENTS.md` §17 status table, this document, `README.md`, and affected `docs/` whenever a phase's status or public behavior changes.

---

## Forward Roadmap (Phases 15–20)

The following phases are planned future work. None are complete — they are targets for future development. Phases 15–20 build on the completed baseline (0–14); they do not re-implement work already delivered in phases 10–14. When a sub-phase is completed, move it from this section to the completed baseline table above.

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
  - Complete SOC 2 Type II (CC4/CC6/CC7) and GDPR evidence tied to collected artifacts; run the go/no-go gate across all burn-in metrics.
- **20.4 Handover report**
  - Repeat the Phase 9.3 handover with real evidence, updated docs, changed files, commands run, results, known limitations, and follow-up work.

**Exit criteria:** Release readiness evidenced for the full burn-in window; handover distinguishes verified capability from remaining gaps.

---

## Dependencies and Ordering (forward phases 15–20)

- **Phase 15** is the default next increment (smallest useful slice: one service at a time).
- **Phase 16** benefits from real providers/stores for meaningful measurement; it may proceed with mocks only if labelled as synthetic.
- **Phase 17** requires Phase 15/10 store/provider decisions (persistent store semantics, tenancy fields).
- **Phase 18** requires Phase 15 runtime boundaries for meaningful isolation/audit evidence.
- **Phase 19** requires Phases 15–18 for realistic measurement.
- **Phase 20** requires Phases 15–19 for a full burn-in window.

## How to Update This Document

1. When a phase/sub-phase completes, update the status table (this file) and the status table in `AGENTS.md` §17 with the **actual** evidence (commands run, results, artifacts).
2. Re-run `npm run typecheck`, `npm test`, `npm run build`, `npm run evaluate`, and (where relevant) `node scripts/benchmark-smoke.mjs`; record real results only.
3. If public behavior, configuration, or commands changed, update `README.md` and the relevant `docs/` file in the same change.
4. Move the phase from "forward roadmap" to "completed baseline" only when its exit criteria are met — partial progress stays in the roadmap table with an explicit note.
