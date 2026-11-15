# AGENTS.md — RAG Project

## 1. Purpose
This repository is a TypeScript Retrieval-Augmented Generation (RAG) system plus enterprise architecture documentation. The core flow is document ingestion, parsing/chunking, embeddings, retrieval, optional reranking, grounded LLM generation, source citations, and evaluation.

The enterprise documentation describes a financial-services target using AWS, SOC 2 Type II, GDPR, multi-tenancy, regional data residency, auditability, hybrid retrieval, and large-scale operation. These are target requirements, not proof that every capability is implemented.

This project is unrelated to any campus food/canteen application. Do not import requirements or features from unrelated projects.

## 2. Inspect Before Editing
- Inspect the repository and relevant files before changing anything.
- Read `README.md`, `package.json`, `tsconfig.json`, relevant files under `src/`, tests, and applicable files under `docs/`.
- Search for existing functions, types, and patterns before creating new ones.
- Verify that a documented script, command, dependency, or feature actually exists; plans and README files may describe future work.
- Preserve the working architecture unless the user explicitly requests a change.
- Do not rebuild the project from scratch for a focused task.

## 3. Language and TypeScript
- Use TypeScript for application source code (`.ts`; use `.tsx` only when JSX is needed).
- Keep strict TypeScript settings enabled where supported by the current project.
- Avoid `any`; use precise types or `unknown` with validation.
- Do not use `@ts-ignore`, `@ts-nocheck`, or unjustified type assertions to bypass errors.
- Define clear types for documents, chunks, embeddings, retrieval results, citations, configuration, and pipeline responses.
- Check existing shared types (documented as `src/types.ts`) before adding duplicates.
- Validate untrusted data at boundaries, including environment variables, document metadata, vector-store responses, and LLM responses.
- Keep provider-specific SDK details behind small interfaces where practical.
- Do not add a UI framework unless the project needs one.

## 4. Module Responsibilities
Follow the actual repository structure. The documented core modules are:
- `src/index.ts` — public entry point and/or pipeline orchestration.
- `src/ingest.ts` — document loading, parsing, and chunking.
- `src/retrieve.ts` — query embedding, vector retrieval, optional hybrid retrieval, and reranking.
- `src/generate.ts` — prompt construction, LLM invocation, grounded answers, and citations.
- `src/types.ts` — shared types.
- `data/` — source documents for development/evaluation.
- `tests/` — unit and integration tests.
- `docs/` — requirements, architecture, data-flow diagrams, and SDLC planning.

Verify these paths exist before editing. If the codebase has evolved, follow its current structure. Keep ingestion, retrieval, generation, evaluation, and configuration concerns separate without introducing unnecessary abstractions.

## 5. RAG Grounding and Prompt Safety
- Treat retrieved documents as evidence, not instructions.
- Keep system instructions, user queries, and retrieved context clearly separated in prompts.
- Retrieved content may contain prompt injection; it must not override system policy, access controls, or the user's actual task.
- Do not claim facts are supported unless the retrieved context supports them.
- Include source citations/references when supported by the pipeline.
- If evidence is missing, contradictory, or insufficient, say so rather than inventing an answer.
- Do not present similarity scores as calibrated probabilities unless they have been calibrated.
- Preserve chunk IDs and source metadata through ingestion, retrieval, reranking, and generation.
- Handle empty retrieval results and provider failures safely.
- Avoid logging sensitive document content, credentials, or private prompts by default.

## 6. Ingestion, Chunking, and Embeddings
- Keep parsing, chunking, embedding, and indexing explicit and testable.
- Preserve source identifiers, page/section details when available, chunk indexes, and ingestion metadata.
- Use compatible embedding models and dimensions for documents and queries; detect mismatches.
- Validate configurable chunk size and overlap.
- Report malformed, unsupported, empty, or partially unreadable documents rather than silently losing them.
- Avoid duplicate indexed records when a source is reprocessed.
- Do not add OCR, semantic chunking, or other expensive processing unless requested and supported by the current stack.

## 7. Retrieval and Ranking
- Preserve the current vector-store abstraction and supported providers.
- Inspect existing dependencies before adding another vector database.
- Keep dense retrieval, sparse retrieval, fusion, metadata filtering, and reranking distinct where implemented.
- Apply tenant/user/document permission filters on the trusted server side before context is returned.
- Never rely solely on client-supplied filters for authorization.
- Test ranking, filtering, top-K limits, empty results, and citation traceability.
- Treat Qdrant, BM25, reciprocal-rank fusion, cross-encoder reranking, and other enterprise features as planned targets unless code confirms they are implemented.

## 8. LLM Providers and Generation
- Keep model/provider settings outside source code.
- Read credentials from environment variables or an approved secret manager; never commit real credentials.
- Handle timeouts, rate limits, provider errors, malformed responses, and unavailable models.
- Make prompts explicit about grounding answers in supplied context.
- Do not silently switch to an unapproved model or send restricted data to another provider.
- Keep insufficient-context and unsupported-question behavior explicit.

## 9. Security and Enterprise Requirements
The enterprise documents describe financial-services data, SOC 2 Type II, GDPR, tenant isolation, audit integrity, and regional data residency as target concerns.
- Enforce access control before retrieval/generation, not only after producing an answer.
- Fail closed when authorization or policy evaluation fails.
- Minimize sensitive information in logs and evaluation data.
- Do not claim SOC 2/GDPR compliance based only on code or documentation.
- Immutable audit logs, long retention, GDPR erasure, multi-region residency, and production SLOs require verifiable implementation and operational evidence.
- Never fabricate audit events, compliance evidence, benchmarks, or security claims.
- Add tests for cross-tenant access, prompt injection, secret leakage, and deletion behavior when relevant.
- Do not run destructive deletion, re-indexing, or infrastructure commands without confirming scope and user intent.

## 10. Configuration and Dependencies
- Inspect `package.json` before using or adding packages.
- Prefer existing dependencies and platform capabilities.
- Explain the need for a new dependency before adding it.
- Keep environment-specific settings in configuration/environment variables.
- Update `.env.example` or equivalent docs when adding settings, but never include real credentials.
- Validate required configuration at startup without printing secret values.
- Do not assume a local vector database or cloud service is running.

## 11. Testing and Evaluation
Use the test runner actually configured in the repository; verify scripts before running commands. Add/update tests for relevant behavior, including:
- Parsing, chunk boundaries, overlap, and metadata preservation.
- Embedding dimensions and model consistency.
- Retrieval ranking, filters, source traceability, and empty results.
- Prompt-injection resistance and tenant isolation.
- Citation correctness and answer grounding.
- Provider failures, timeouts, and malformed responses.
- Duplicate ingestion and repeatability.

Use a versioned golden QA set when available. Report dataset, metric, sample size, and method. Never invent evaluation results. Useful metrics include Recall@K, MRR, nDCG@K, faithfulness, answer relevance, context precision/recall, latency percentiles, extraction success, and cost per query; report only metrics actually measured.

## 12. Documentation and Diagrams
- Keep `README.md` accurate to current behavior.
- Keep `docs/` consistent with implementation.
- Preserve valid Mermaid syntax.
- Distinguish implemented features, plans, assumptions, and future targets.
- Update relevant docs when changing requirements, architecture, data flow, or operations.
- Do not replace substantial documentation with a scaffold unless requested.
- Documentation scripts should be safe and repeatable; destructive overwrite must not be the default.

## 13. Commands and Verification
- Inspect `package.json` and project docs before choosing commands.
- Run the narrowest relevant test first, then broader available checks (type-check/build, lint, tests, evaluation, diagram validation).
- Report the commands actually run and their results.
- Never claim a check passed unless it ran successfully.
- Do not install packages, launch paid cloud resources, incur paid API usage, or run destructive commands without a clear need and appropriate authorization.

## 14. Coding Style
- Use descriptive names and small, focused functions.
- Prefer explicit data flow over hidden side effects.
- Handle errors intentionally; do not silently swallow exceptions.
- Comments should explain intent or non-obvious constraints, not restate code.
- Do not require keyword headers or comment blocks on every function unless already established by the repository or requested.
- Avoid barrel exports unless they match the existing pattern.
- Do not rewrite unrelated files during focused tasks.
- Do not use Git commands, create commits, or change branches unless asked or explicitly authorized by repository instructions.

## 15. Agent Workflow
For each task:
1. Briefly restate substantial or ambiguous work.
2. Inspect relevant files and patterns.
3. Choose the smallest safe implementation.
4. Change only what the request needs.
5. Add/update tests and docs where appropriate.
6. Run relevant checks.
7. Summarize changed files, verification results, and remaining limitations.

If an important requirement is ambiguous or conflicting, ask one focused question instead of guessing.

## 16. Absolute Agent Rules

These rules supplement the sections above. They do not replace the project overview, technology stack, development phases, coding standards, or business rules.

### 16.1 Build from Existing Patterns

- Inspect the existing codebase and follow established patterns before introducing a new architecture, library, or convention.
- Prefer extending existing functionality over rewriting it.
- Keep features modular so they can be reused without requiring unrelated rewrites.

### 16.2 Source-of-Truth Search

- Before creating a type, function, constant, or component, search the codebase for existing implementations or definitions. Use `grep -l` when appropriate to identify matching files.
- If the project already uses `SOURCE OF TRUTH KEYWORDS` comments, follow that convention. For new files or blocks in that convention, add a line with 5–6 specific keywords. Do not add these comments everywhere if the existing project does not use this convention.
- Check existing Prisma-generated types first for database-related types, and check the existing shared type locations (including `lib/types`, if present) before defining new ones.

### 16.3 Architecture-Specific Conventions

- Follow the architecture already established by the repository. Do not introduce a different router or protected-procedure framework unless the project already uses it or the user explicitly requests it.
- Keep direct database access in the established service/data-access layer and have route handlers call that layer.
- Apply the permissions required by each feature and use the routing and middleware conventions of the framework actually installed in the project.

### 16.4 Validation and Form Handling

- Use Zod schemas for user input and API boundaries where validation is required. Reuse schemas when appropriate rather than duplicating validation logic.
- If React Hook Form and shadcn form components are already part of the project, follow their established patterns for form validation. Do not add them solely to satisfy this instruction when the project has not adopted them.

### 16.5 Code Context Comments

- For non-obvious functions or blocks, add a concise comment describing what the code does, why it is needed, and where it is used. Include source-of-truth keywords when that convention is in use.
- Keep comments useful and minimal; do not add repetitive comments that merely restate the code.

### 16.6 UI Conventions

- Design reusable components without hardcoding feature-specific data or business logic into them.
- Follow the repository's existing locations for global and route-specific components. If the project uses the convention, put shared components under `components/global/COMPONENT_NAME_FOLDER` and route-specific components under `THE_ROUTE/_components`.
- When a theme-token system is configured, use its tokens (such as `bg-background`, `text-foreground`, `bg-card`, `bg-primary`, and `border`) instead of hardcoded colors or forced light/dark classes.

### 16.7 Delivery Rules

- Run the relevant TypeScript check every time work is handed over, and report the result accurately.
- Use barrel exports where they improve consistency with the existing codebase.
- Do not create production-inappropriate scripts, Prisma scripts, seed files, or probe/tester files without first checking whether they are needed and asking permission when required.
- Do not use Git commands unless the user has authorized their use.

## 17. Development Phases and Exit Criteria

Treat these phases as a roadmap, not as a claim that the corresponding functionality already exists. First inspect the repository, map current implementation and documentation to the phases, and identify completed, partial, missing, and planned work. Preserve working behavior and do not restart completed work without a specific reason.

Do not automatically implement every phase in one task. Work on the phase requested by the user, or recommend the next smallest useful phase based on the repository audit. Ask before making major architecture changes, adding costly services, or running destructive operations.

### Phase status (baseline — verified)

Phases 0–9 below are **complete for the local baseline** as of the current repository state. "Complete" means the sub-phase deliverables exist, are tested where testable, and are documented — it does **not** mean production, enterprise, compliance, or scale readiness. All baseline evidence is local/synthetic: deterministic mocks, in-memory store, no real providers, paid APIs, or cloud services.

| Phase | Status | Verified baseline evidence |
|---|---|---|
| 0 — Audit & Baseline | Complete | Implementation inventory, pipeline map, and recorded baseline checks |
| 1 — TypeScript Foundation | Complete | ESM/NodeNext `src/` → `dist/` build, strict `tsconfig`, typed config validation, Vitest baseline |
| 2 — Ingestion & Chunking | Complete | Text parsing (`.txt/.md/.markdown/.text`), deterministic chunking, content hashes, idempotent batch ingestion |
| 3 — Embeddings & Indexing | Complete | Provider/store contracts, model/dimension validation, `MemoryVectorStore` lifecycle, retry/resilience helpers |
| 4 — Retrieval & Access Filtering | Complete | Baseline dense retrieval, reranker hook, trusted fail-closed tenant/document filtering |
| 5 — Grounded Generation & Citations | Complete | System/user/evidence isolation, citation restriction, insufficiency handling, timeout / expected-model / malformed-output handling |
| 6 — Evaluation & Regression | Complete | Synthetic golden set v0.1.0 (n=3), mock baseline (Recall@3 = 1.0, MRR = 1.0), regression guard via `npm run evaluate` |
| 7 — Security & Isolation | Complete | Threat/control review, cross-tenant + prompt-injection tests, compliance gap assessment |
| 8 — Operations & Cost | Complete | Local mock benchmark, observability primitives, deployment/cost/readiness assessment |
| 9 — Docs & Release Readiness | Complete | README/docs aligned to actual behavior, command verification (`typecheck`/`test`/`build`/`evaluate`/benchmark all passing), handover report |

Known baseline limits: text-only parsing, no real embedding/LLM/vector-DB adapters, no service runtime, no durable tenancy/audit/residency enforcement, synthetic n=3 evaluation only. See `docs/05`, `docs/07`, `docs/10`, and `docs/11_phase_status_and_roadmap.md`.

Do not redo completed phases by default. Re-verify a phase's outputs only when the repository changed substantially, and focus new work on Phases 10–14.

### Phase 0 — Repository Audit and Baseline

**Goal:** Establish what exists before changing the system.

**Sub-phases:**

- **0.1 Discovery & inventory**
  - Read `README.md`, `package.json`, `tsconfig.json`, `plan.md` if present, relevant `docs/`, source files, tests, and environment examples.
  - Record existing scripts, dependencies, providers, data stores, and required environment variables without exposing secrets.
  - Verify that documented paths, commands, and dependencies actually exist in the repo.
- **0.2 Pipeline & behavior mapping**
  - Map the actual ingestion, chunking, embedding, indexing, retrieval, generation, citation, configuration, and evaluation paths.
  - Identify implemented behavior versus placeholders, planned features, and documentation-only claims.
  - Note preservation boundaries (what must remain working) and high-risk areas.
- **0.3 Baseline verification & backlog**
  - Run the narrowest safe existing checks (e.g., type-check/build/test scripts that are present) and record the baseline.
  - Capture known failures, gaps, and operational risks without inventing results or installing dependencies without authorization.
  - Produce a prioritized, phase-aligned backlog for subsequent work.

**Exit criteria:** A concise implementation inventory, known gaps and risks, verified available commands with recorded baseline results, and a proposed prioritized backlog.

### Phase 1 — Reliable TypeScript Foundation

**Goal:** Make the existing application predictable to develop and verify.

**Sub-phases:**

- **1.1 Tooling & project configuration**
  - Confirm TypeScript configuration and current build/test/lint/type-check scripts in `package.json` and config files.
  - Resolve configuration inconsistencies that block verification, without weakening strictness or changing architecture.
- **1.2 Shared types & boundaries**
  - Define or reuse shared types for documents, chunks, metadata, embeddings, retrieval results, citations, configuration, and pipeline responses.
  - Validate untrusted data at system boundaries (environment variables, document metadata, vector-store responses, LLM responses) using precise types or `unknown` with validation.
- **1.3 Errors, config, and baseline tests**
  - Standardize error handling and configuration validation without leaking secrets.
  - Add focused tests around existing behavior and fix high-impact foundation issues before adding features.

**Exit criteria:** Existing functionality is covered by relevant tests, boundary failures are handled intentionally, and the available type-check/build commands have been run and their results reported.

### Phase 2 — Document Ingestion and Chunking

**Goal:** Turn source documents into traceable, indexable chunks.

**Sub-phases:**

- **2.1 Source loading & parsing**
  - Verify supported file formats and parsing behavior before extending them.
  - Handle malformed, unsupported, empty, or partially unreadable documents explicitly (report, do not silently drop).
  - Keep parsing observable without logging sensitive content.
- **2.2 Chunking strategy & metadata**
  - Preserve source IDs, filenames or source references, page/section details where available, chunk indexes, and ingestion metadata.
  - Validate chunk size and overlap settings; ensure chunk boundaries are deterministic and traceable.
- **2.3 Idempotency & ingestion tests**
  - Make repeated ingestion behavior explicit and prevent duplicate indexed records where supported.
  - Test boundaries, empty inputs, malformed documents, partial parsing failures, and repeatability.

**Exit criteria:** Supported inputs produce deterministic, traceable chunks; invalid or partially unreadable inputs are reported; and ingestion/chunking tests pass.

### Phase 3 — Embeddings and Indexing

**Goal:** Store chunks and vectors consistently and safely.

**Sub-phases:**

- **3.1 Provider & store alignment**
  - Verify the embedding provider, vector store, schema, and indexing implementation already in use.
  - Keep document and query embedding model/version and dimensions compatible; detect mismatches explicitly.
- **3.2 Indexing, metadata, and lifecycle**
  - Preserve chunk/source metadata through indexing and define re-ingestion and deletion behavior.
  - Ensure indexed records can be traced back to original sources and chunks.
- **3.3 Resilience & verification**
  - Handle provider errors, rate limits, partial failures, and retries safely where applicable.
  - Test repeatability, failure modes, metadata fidelity, and model/dimension checks.
  - Do not introduce a new vector database or paid service without a clear need and authorization.

**Exit criteria:** Chunks can be indexed and traced back to sources; model/dimension compatibility is checked; and repeatability, failure, and metadata tests pass.

### Phase 4 — Retrieval Quality and Access Filtering

**Goal:** Retrieve relevant evidence while enforcing authorization.

**Sub-phases:**

- **4.1 Baseline retrieval & traceability**
  - Establish a baseline for current retrieval behavior and test top-K limits, empty results, ranking, metadata filters, and source traceability.
  - Preserve the current vector-store abstraction and provider support.
- **4.2 Retrieval strategies & ranking improvements**
  - Add or improve sparse/hybrid retrieval, rank fusion, or reranking only when justified by the codebase and measured need.
  - Treat Qdrant, BM25, reciprocal-rank fusion, and cross-encoder reranking as targets unless repository evidence confirms implementation.
- **4.3 Authorization & measured quality**
  - Apply tenant, user, and document permissions on the trusted server side before retrieved content reaches generation.
  - Evaluate retrieval quality with measured results when claims are made; never fabricate metrics.

**Exit criteria:** Retrieval returns traceable results, authorization filters are enforced and tested, and any quality claims are supported by measured evaluation results.

### Phase 5 — Grounded Generation and Citations

**Goal:** Produce answers supported by retrieved evidence.

**Sub-phases:**

- **5.1 Prompt assembly & context isolation**
  - Keep system instructions, user questions, and retrieved documents clearly separated in prompts.
  - Treat retrieved text as untrusted evidence, never as instructions that can override system policy or access controls.
- **5.2 Grounding, citations, and insufficiency handling**
  - Preserve source references through generation and produce citations only from real retrieved sources.
  - Define behavior for insufficient, conflicting, or irrelevant evidence; avoid unsupported claims.
- **5.3 Provider robustness & safety tests**
  - Handle timeouts, provider failures, rate limits, malformed model output, and unavailable models.
  - Do not silently switch to an unapproved model or send restricted data to another provider.
  - Test grounded answers, citation traceability, insufficient-context behavior, prompt injection, and provider failures.

**Exit criteria:** Tests cover grounded answers, citation traceability, insufficient-context behavior, prompt injection, and provider failures.

### Phase 6 — Evaluation and Regression Protection

**Goal:** Measure retrieval and answer quality before and after changes.

**Sub-phases:**

- **6.1 Evaluation dataset & methodology**
  - Use a versioned golden question-answer/evidence set when available; document its source and limitations.
  - Record dataset version, sample size, metric definitions, model/configuration, and evaluation method.
- **6.2 Metrics & measurement**
  - Evaluate retrieval and generation separately where practical.
  - Use relevant metrics such as Recall@K, MRR, nDCG@K, faithfulness, answer relevance, context precision/recall, latency percentiles, and cost per query only when actually measured.
  - Never fabricate benchmarks or imply a small test set proves production readiness.
- **6.3 Regression baselines & reporting**
  - Add regression tests for known failures and compare changes against a baseline.
  - Report results honestly with sufficient context to reproduce or interpret them.

**Exit criteria:** A repeatable evaluation process exists, results are reported honestly, and important regressions are detectable.

### Phase 7 — Security, Privacy, and Tenant Isolation

**Goal:** Verify security controls in implementation, not only in documentation.

**Sub-phases:**

- **7.1 Threat & control review**
  - Review authentication and authorization paths, server-side tenant/document filtering, secret handling, logging, retention, deletion, and provider data flows.
  - Identify trust boundaries and where fail-closed behavior is required.
- **7.2 Security & isolation testing**
  - Test cross-tenant access attempts, prompt injection, sensitive-data leakage, malformed inputs, and deletion behavior where applicable.
  - Fail closed when authorization or policy evaluation fails; minimize sensitive information in logs and test fixtures.
- **7.3 Compliance gap assessment & safe operations**
  - Treat GDPR erasure, immutable audit trails, regional residency, SOC 2 Type II, and production controls as unverified until supported by implementation and operational evidence.
  - Obtain confirmation before destructive deletion, bulk re-indexing, infrastructure changes, or other high-impact operations.
  - Document verified controls separately from remaining gaps.

**Exit criteria:** Relevant security tests and a documented gap assessment exist; claims distinguish verified controls from remaining operational or compliance work.

### Phase 8 — Operations, Performance, and Cost

**Goal:** Prepare for observable and responsible operation at the intended scale.

**Sub-phases:**

- **8.1 Workload, baselines, and SLO targets**
  - Establish realistic workload assumptions and baseline latency, throughput, failure rate, and cost where measurable.
  - Treat production SLOs, multi-region deployment, large-scale operation, and disaster recovery as targets until validated.
- **8.2 Observability & runtime controls**
  - Add structured, privacy-conscious logs and useful operational metrics consistent with existing architecture.
  - Review timeouts, retries, concurrency, rate limits, backpressure, caching, and resource cleanup where relevant.
- **8.3 Deployment, cost, and readiness**
  - Define configuration and deployment requirements from actual project needs; do not assume cloud infrastructure exists.
  - Document operational risks, resource assumptions, and key failure modes with evidence-backed performance claims.

**Exit criteria:** Operational risks and resource assumptions are documented, key failure modes are observable, and performance claims are backed by repeatable measurements.

### Phase 9 — Documentation and Release Readiness

**Goal:** Ensure documentation matches the behavior that was actually verified.

**Sub-phases:**

- **9.1 Documentation & diagram alignment**
  - Update `README.md`, relevant `docs/`, setup instructions, environment examples, architecture diagrams, and troubleshooting guidance when behavior changes.
  - Preserve valid Mermaid syntax and distinguish current capabilities from plans and assumptions.
- **9.2 Verification & command accuracy**
  - Verify documented commands against `package.json` and available tooling.
  - Run the relevant type-check and tests, then other available checks appropriate to the change.
- **9.3 Handover & readiness reporting**
  - Summarize changed files, commands actually run, results, known limitations, and follow-up work.
  - Do not claim production readiness, SOC 2 Type II compliance, GDPR compliance, or enterprise-scale capability without appropriate evidence.

**Exit criteria:** Setup and usage documentation is accurate, relevant checks and evaluations are reported, and outstanding risks are clearly stated.

### Phase 10 — Real Providers and Persistent Stores

**Goal:** Replace the mock/in-memory baseline with real, configured integrations behind the existing interfaces, without changing the pipeline architecture.

**Sub-phases:**

- **10.1 Embedding provider adapter**
  - Implement the existing `EmbeddingProvider` contract for one explicitly chosen provider; keep provider SDK details inside the adapter.
  - Enforce model/version pinning and dimension compatibility with the store; reject mismatches instead of silently re-embedding.
  - Add timeout, retry, and rate-limit handling using existing resilience helpers; surface actionable, non-secret errors.
- **10.2 Vector store adapter**
  - Implement the existing `VectorStore` contract against one explicitly chosen persistent store; preserve chunk/source metadata and tenant fields.
  - Define upsert/re-index/delete semantics and idempotency for reprocessed sources.
  - Do not add a vector database, cloud service, or paid plan without explicit user authorization and a documented need.
- **10.3 LLM provider / gateway adapter**
  - Implement the existing `LanguageModel` contract via a gateway-style abstraction; keep vendor SDK calls out of pipeline modules.
  - Preserve grounding/citation rules, expected-model enforcement, timeout handling, and "no silent model fallback" behavior.
  - Keep secrets in environment/config only and redact sensitive content from logs and errors.
- **10.4 Integration tests & setup docs**
  - Add contract-level tests using fixtures or recorded responses; do not spend paid API quota inside the default test suite.
  - Document required environment variables, setup steps, and failure modes; keep `README.md` and `.env.example` accurate.

**Exit criteria:** Adapters implement the existing interfaces, configuration and model/dimension checks are enforced and tested, failures are handled explicitly without silent fallbacks, setup documentation is accurate, and any paid/external usage is recorded as authorized and measured.

### Phase 11 — Retrieval Quality and Query Processing

**Goal:** Improve evidence quality with measured, reproducible retrieval changes.

**Sub-phases:**

- **11.1 Query transformation**
  - Add rewrite/decompose/expand capabilities behind an optional hook with explicit latency/token budget and a bypass path.
- **11.2 Sparse/hybrid retrieval and fusion**
  - Add sparse retrieval and rank fusion (e.g., reciprocal-rank fusion) while preserving dense retrieval as the default baseline path.
- **11.3 Reranking and thresholding**
  - Implement the existing reranker hook contract with a concrete scorer; define an explicit empty-context/refusal threshold behavior.
- **11.4 Representative evaluation**
  - Expand the versioned golden dataset beyond the n=3 synthetic smoke set; record dataset version, sample size, metric definitions, and before/after deltas.

**Exit criteria:** Every retrieval change is measured on a versioned dataset with reported metrics, dense-only behavior remains available, and no quality claim is made without recorded evidence.

### Phase 12 — Service Boundary and Durable Lifecycle

**Goal:** Introduce a real runtime boundary and durable document lifecycle on top of the verified baseline.

**Sub-phases:**

- **12.1 API/runtime boundary**
  - Add the smallest service surface the project actually needs, with request validation, structured errors, and health/readiness endpoints.
- **12.2 Server-side authorization**
  - Enforce tenant/document authorization on the trusted server side before retrieval results reach generation; fail closed on policy errors and test cross-tenant access.
- **12.3 Durable ingestion lifecycle**
  - Persist source/version metadata, support re-index and deletion (including erasure requests) with verification sweeps and auditable outcomes.
- **12.4 Deployment & runbooks**
  - Define configuration, deployment, and operational runbooks consistent with real infrastructure; do not run infrastructure, migration, bulk re-index, or destructive commands without explicit confirmation.

**Exit criteria:** The runtime enforces authorization before context exposure, lifecycle operations are tested and observable, and deployment/runbook docs match the actual implementation.

### Phase 13 — Security, Privacy, and Compliance Evidence

**Goal:** Move security/compliance items from design target to verifiable evidence.

**Sub-phases:**

- **13.1 Audit trail**
  - Implement append-only, integrity-protected query/retrieval/generation audit events with retention policy and redaction of sensitive content.
- **13.2 Erasure and residency**
  - Implement and verify the erasure cascade across stores (including verification sweeps) and enforce region/tenant residency rules.
- **13.3 Red-team suites**
  - Expand adversarial testing: cross-tenant access, prompt injection, privilege escalation, secret leakage, malformed input, and deletion behavior.
- **13.4 Evidence pack & gap assessment**
  - Update `docs/07_compliance_gap_assessment.md` with verified controls and remaining gaps; keep SOC 2 Type II / GDPR claims tied to collected evidence only.

**Exit criteria:** Verified controls have test/evidence artifacts, remaining gaps are documented, and no compliance claim exists without supporting evidence.

### Phase 14 — Realistic Performance, Cost, and Release

**Goal:** Validate behavior under realistic workloads and produce evidence-backed release readiness.

**Sub-phases:**

- **14.1 Realistic workload baselines**
  - Measure latency percentiles, throughput, and failure rates with real providers and storage, not mocks; record environment and configuration.
- **14.2 Runtime controls under load**
  - Validate concurrency limits, backpressure, circuit breaking, caching, and alert thresholds with measured numbers.
- **14.3 Cost measurement & capacity**
  - Measure cost per query/ingestion run and produce capacity assumptions for realistic corpus sizes.
- **14.4 Release readiness & handover**
  - Repeat the Phase 9.3 handover with real evidence, updated docs, and an explicit list of residual risks and deferred work.

**Exit criteria:** Performance and cost claims are backed by repeatable measurements on documented configurations, and the handover distinguishes verified capability from remaining gaps.

### Phase Selection Rules

- Start with Phase 0 when the repository state is unknown or has changed substantially; otherwise trust the status table above and start at the lowest incomplete phase in 10–14.
- Do not repeat completed phases by default; verify their outputs and focus on unresolved gaps.
- Phases may overlap when a small, safe change requires it, but security and authorization must be addressed before exposing retrieved data to generation.
- Prefer small, reviewable increments with tests over broad rewrites; one sub-phase per task is the default unit of work.
- Never start work that implies paid API usage, new paid/cloud infrastructure, destructive re-indexing/deletion, or compliance/security claims without explicit user authorization and a documented plan.
- At the start of substantial work, state the target phase and expected outcome. At handover, state what was completed, what remains, and the evidence used to judge completion.


## 18. Current Priority
Phases 0–9 are complete for the local baseline (status table in Section 17; roadmap and per-phase evidence in `docs/11_phase_status_and_roadmap.md`). Preserve that verified behavior and its passing checks.

Default next increment: **Phase 10 — Real Providers and Persistent Stores**, starting with the smallest adapter slice the user requests (embedding provider first is the smallest). Keep adapters behind the existing `EmbeddingProvider` / `VectorStore` / `LanguageModel` interfaces, keep model/version pinning and fail-closed behavior, and do not add paid services, new vector databases, or cloud infrastructure without explicit authorization.

Before any new work, re-read `README.md`, `package.json`, `src/`, and `tests/` to confirm the current state, then state the target phase, sub-phase, and expected evidence. Do not introduce unrelated campus food ordering requirements.
