---
title: "Requirement Analysis - Enterprise RAG"
artifact_id: RAG-REQ-001
package_part: "2 of 4"
domain: Financial Services
cloud_target: "AWS (us-east-1 primary, eu-west-1 for EU data residency)"
compliance: [SOC 2 Type II, GDPR]
scale_targets: ["10M+ documents", "P95 < 800 ms", "99.9% monthly availability"]
status: draft
version: 0.1.0
owner: Platform Architecture
---

# Part 2 - Requirement Analysis (Scope, Actors, FRs, NFRs, Constraints)

## 2.1 Scope & Vision

**Vision.** A single enterprise knowledge plane that lets authorized financial-services staff retrieve, cite, and reason over 10M+ regulated documents (contracts, prospectuses, 10-K/10-Q filings, research notes, call transcripts, internal policies, regulatory guidance) with answers that are always grounded in source material, always attributed, and always auditable — at sub-800ms P95 latency.

**In scope**

| # | Scope Element | Description |
|---|---|---|
| S-1 | Document ingestion | Parse → chunk → embed → index pipeline for PDF, HTML, DOCX, Markdown, XLSX (table cells), and email (EML/MBOX) |
| S-2 | Retrieval | Hybrid dense (ANN) + sparse (BM25) retrieval with reciprocal-rank fusion and metadata/tenant filtering |
| S-3 | Re-ranking | Cross-encoder relevance re-ranking of fused candidate pools |
| S-4 | Query transformation | LLM-driven rewriting, decomposition, and multi-query expansion |
| S-5 | Answer generation | LLM synthesis with mandatory source citations and per-claim confidence scores |
| S-6 | Access control | Tenant-isolated, role-based pre-retrieval enforcement (RBAC + ABAC attributes) |
| S-7 | Audit & governance | Immutable query/response/retrieval audit trail, 7-year retention, GDPR erasure workflows |
| S-8 | Observability | Latency, throughput, retrieval quality, embedding-drift, and SLA monitoring with alerting |

**Out of scope (boundary conditions)**

| # | Excluded | Rationale |
|---|---|---|
| O-1 | End-user document authoring/editing | DMS / Office suites remain the system of record |
| O-2 | Automated trading or credit-decision automation | System is advisory; human-in-the-loop mandatory (model-risk policy) |
| O-3 | Fine-tuning or training of LLMs | RAG by design; model updates via gateway reconfiguration only |
| O-4 | BI/reporting dashboards and data-warehouse ETL | Separate analytics domain |
| O-5 | Cross-organization (B2B counterparty) knowledge sharing | Multi-tenant ≠ multi-organization data sharing |

**Ingestion channels (system boundary inputs)**

1. **Object store (S3)** — primary channel; raw-document lake with WORM-compliant buckets, event-driven trigger on new/updated objects.
2. **SharePoint / M365** — incremental connector for policies, procedures, compliance memos.
3. **Email archive** — PST/EML export for deal correspondence (high PII exposure; redaction pipeline mandatory).
4. **Document Management System (DMS)** — contract and deal-room systems via REST API + version metadata.
5. **Regulatory & market feeds** — SEC EDGAR filings and licensed research repositories (Bloomberg/REFINITIV) as scheduled batch.
6. **Admin upload** — manual drop-off via authenticated UI/API for ad-hoc documents.

**System deliverables**

| Deliverable | Acceptance |
|---|---|
| Production RAG service (ingest + query + audit) | Meets all NFRs in §2.4 for 30 consecutive days in staging |
| Golden-evaluation harness (≥ 1,000 labeled QA pairs) | Recall@10, MRR, nDCG@10 reproducible per release |
| Runbooks (ingestion, erasure, failover, index rebuild) | Drilled by SRE in chaos tests |
| SOC 2 Type II evidence pack | CC6 (logical access), CC7 (change management), CC4 (monitoring) evidence complete |
| Architecture documentation (this package) | Approved by Architecture Review Board |

## 2.2 System Actors

**Human actors**

| Actor | Type | Responsibilities | Trust level |
|---|---|---|---|
| Knowledge Worker (Analyst/Associate) | Human | Submit queries, review grounded answers, flag low-confidence results | Authentication + role + tenant membership |
| Compliance Officer | Human | Review audit logs, verify retrieval traceability, manage retention policies | Authenticated, read-only on audit store |
| System Administrator | Human | Tenant onboarding, ingestion channel configuration, RBAC policy authoring | Privileged, changes are audit-logged + dual-approved |
| Platform SRE | Human | Capacity planning, index operations, SLA monitoring, incident response | Infrastructure access, no document content access |
| Internal Auditor | Human | Evidence sampling, integrity verification of audit trail | Read-only, time-boxed access |
| Data Steward | Human | Document classification (confidentiality tiers), erasure request triage | Metadata-level access only |

**System actors**

| Actor | Type | Responsibility | Interface |
|---|---|---|---|
| Query Orchestrator | System | Routes query, enforces RBAC pre-filter, orchestrates pipeline stages | API gateway |
| Ingestion Pipeline | System | Parse → chunk → enrich metadata → embed → upsert | Event queue |
| Embedding Service | System | Vector generation (1,536-dim), model version pinning, drift monitoring | gRPC |
| Vector Store (Qdrant) | System | ANN index (HNSW) + sparse (BM25/sparse vectors) storage, tenant partitioning | gRPC |
| LLM Gateway | System | Model routing, token budgeting, retries, PII redaction, circuit breaking | REST |
| Re-ranker | System | Cross-encoder scoring of fused top-K pool | gRPC |
| RBAC / Policy Service | System | Policy evaluation, tenant/role/attribute claims, pre-retrieval filter translation | gRPC |
| Audit Logger | System | Immutable append-only event capture (query, candidates, prompt, response) | Write-once store |
| Raw Document Store | System | Source-of-truth object storage, WORM where required | Object API |

## 2.3 Functional Requirements

| ID | Requirement | Detail & Acceptance Criteria |
|---|---|---|
| FR-01 | **Document ingestion & normalization** | Ingest PDF, HTML, DOCX, Markdown, EML from all channels in §2.1. Parse with layout-aware extraction (tables preserved), extract OCR text where needed. *Accept: ≥ 98% of sample pages extract to machine-readable text; ingestion events processed ≤ 15 min p95 from source commit; idempotent upserts on document re-processing (no duplicate chunks).* |
| FR-02 | **Chunking & metadata enrichment** | Recursive-semantic chunking (target 512 tokens, 10% overlap), attach metadata: source doc ID, page/cell offset, confidentiality tier, department, tenant ID, classification tags, version, effective/expiration date. *Accept: 100% of chunks carry tenant ID + confidentiality tier; chunk boundary test suite passes on 200-document golden corpus.* |
| FR-03 | **Hybrid retrieval with metadata/tenant filtering** | Combine dense ANN (HNSW, cosine) and sparse BM25 retrieval; fuse via Reciprocal Rank Fusion (k = 60); apply tenant + RBAC + metadata filters *pre-retrieval* (pushdown into index query). *Accept: fused top-60 pool with zero cross-tenant leakage in red-team tests; filter pushdown verified by index query inspection.* |
| FR-04 | **Query transformation & expansion** | Rewrite ambiguous queries, decompose multi-part questions, generate up to 3 paraphrase variants; merge per-variant retrieval results via RRF. *Accept: expansion adds ≤ 250ms p95 pipeline overhead; A/B on golden set shows ≥ +3pt Recall@10 vs. single-query baseline.* |
| FR-05 | **Context re-ranking** | Cross-encoder re-ranker scores fused pool (top-60 → top-5), discard candidates below similarity threshold 0.75; return empty context (refusal) if no candidate passes. *Accept: top-5 selection matches relevance judgment in ≥ 85% of held-out labeled cases; re-rank stage ≤ 120ms p95.* |
| FR-06 | **Grounded answer generation with citations** | LLM generates answer conditioned on top-5 context; every factual claim carries citation (document ID, page/offset, chunk ID) and confidence score; model MUST refuse (not hallucinate) when context is insufficient. *Accept: 100% of answers include ≥ 1 citation or explicit refusal; citation offset verifiable in source; faithfulness ≥ 0.90 on golden set.* |
| FR-07 | **RBAC / multi-tenant access control** | Role-based + attribute-based enforcement with tenant isolation: document-level ACLs, role grants (viewer/contributor/admin), department scoping; policies translated to index filters before retrieval. *Accept: 0 unauthorized document retrievals in penetration test (5,000 probe queries across 50 tenants); policy evaluation ≤ 10ms p95.* |
| FR-08 | **Immutable audit logging & data-subject erasure** | Append-only record per query: requester identity, query, applied filters, candidate IDs + scores, prompt hash (prompt body encrypted, not stored in clear), response, timestamps, model + embedding versions. GDPR erasure: cascade delete from vector store + object store, with retention-safe masking in audit log (keeps "action occurred" record per lawful-basis requirement). *Accept: 100% of query events recorded (log-loss = 0 in 30-day soak); erasure of a data subject completes ≤ 30 days with verified zero residual vectors; audit store is WORM + Merkle-hashed.* |

## 2.4 Non-Functional Requirements

| ID | NFR | Quantitative Target | Measurement Method |
|---|---|---|---|
| NFR-01 | **Latency** | End-to-end P95 < 800 ms, P99 < 1.5 s, at 200 QPS sustained; retrieval stage (pre-LLM) P95 < 300 ms | Prometheus histograms per pipeline stage; synthetic probe every 30 s in each AZ |
| NFR-02 | **Retrieval quality** | Recall@10 ≥ 0.85, MRR ≥ 0.70, nDCG@10 ≥ 0.78; faithfulness ≥ 0.90 on golden evaluation set | Golden set of ≥ 1,000 labeled QA pairs (500 financial, 500 regulatory); offline harness on every release + weekly on 10% production sample |
| NFR-03 | **Throughput & scalability** | ≥ 200 QPS sustained per AZ; 500 QPS burst for 5 min; supports 10M+ source documents (~30M chunks) with ≤ 20% P95 degradation vs. 1M-document baseline | Locust/k6 load tests in staging (production-mirror topology); index size vs. latency curve tracked per index rebuild |
| NFR-04 | **Availability & resilience** | 99.9% monthly availability (≤ 43.8 min downtime/month); RTO ≤ 30 min, RPO ≤ 5 min; multi-AZ failover; LLM-gateway circuit breaker degrades to retrieval-only mode | CloudWatch/SLA dashboards; quarterly multi-AZ failover drill; error-budget burn-rate alerts (1h/6h fast/slow) |
| NFR-05 | **Data freshness** | Ingestion-to-queryable ≤ 15 min p95 for incremental updates; full-corpus rebuild ≤ 72 h with zero query downtime | Event-timestamp delta telemetry; rebuild runbook SLA measured per execution |
| NFR-06 | **Security & confidentiality** | AES-256 at rest (KMS, key rotation ≤ 90 days), TLS 1.3 in transit, mTLS between internal services; 0 PII tokens in outbound LLM prompts (redaction verified); 0 critical/high findings from annual pen test | Conftest/OPA policy scans; CI secret-scan + dependency-scan gates; quarterly red-team exercise; LLM prompt DLP counter |
| NFR-07 | **Observability & model governance** | 100% query-event logging; embedding-drift KL divergence < 0.05/week with auto-reindex trigger; model/embedding version pinning with 2-week rollback window; SLO dashboards for all NFRs | Drift monitor (per-tenant embedding distribution); canary/relabel workflow; all metrics export to Grafana with named SLOs |

## 2.5 System & Architectural Constraints

**Technical constraints**

| # | Constraint |
|---|---|
| C-T1 | Model-agnostic LLM access via gateway only — no direct vendor SDK calls from pipeline services (enables model swap without redeploy). |
| C-T2 | No proprietary managed vector-database SaaS: self-hosted Qdrant on EKS to avoid vendor lock-in and satisfy data-control requirements (acceptable alternative: self-hosted OpenSearch neural search). |
| C-T3 | Embedding model is version-pinned; any model swap requires full re-indexing and a shadow-index A/B evaluation before cutover (C-T3/NFR-07). |
| C-T4 | Deployment topology: us-east-1 primary (us-east-1a/b/c); EU-resident document corpora partitioned and pinned to eu-west-1 — cross-region replication of EU partition to US is prohibited. |
| C-T5 | Max prompt payload 32 K tokens; context window management by the Context Synthesizer (never by the model provider defaults). |
| C-T6 | Python 3.11+ (services), TypeScript (web surfaces); Terraform for all AWS resources (no console-only changes). |

**Legal & regulatory constraints**

| # | Constraint |
|---|---|
| C-L1 | **GDPR** — DPIA completed before production; data-subject erasure ≤ 30 days (FR-08); EU data processed only in eu-west-1 (C-T4); lawful-basis and retention schedule documented per corpus. |
| C-L2 | **SOC 2 Type II** — 7-year immutable audit retention (CC6/CC7/CC4 evidence); quarterly control testing; continuous monitoring with anomaly alerting. |
| C-L3 | **Data classification tiers** — Public / Internal / Confidential / Restricted (PII): tier drives encryption key hierarchy, redaction policy, and access grant; Restricted content cannot be sent to external LLM endpoints (self-hosted or VPC-pinned inference only). |
| C-L4 | **Model risk management** — system is advisory only; no autonomous decisioning (O-2); annual model validation report covering retrieval quality and hallucination rates. |
| C-L5 | Licensed content (research feeds) may not be redistributed outside the organization; citation responses include license-tier markers. |

**Budgetary & operational constraints**

| # | Constraint |
|---|---|
| C-B1 | Steady-state infrastructure cost ≤ $15,000/month at full 10M-document load (Qdrant cluster, EKS, S3, observability). |
| C-B2 | LLM token spend capped at $5,000/month at 200 QPS p90 usage; per-tenant token budgets with hard caps and overage refusal. |
| C-B3 | Team: 6 engineers + 2 SRE + 1 data engineer for all three spiral loops; no dedicated ML research headcount (eval-driven optimization only). |
| C-B4 | 24×5 SRE on-call; change freeze during quarter-end (2 business days); all production changes require blue-green or canary rollout. |

---

## Traceability Matrix (summary)

| Requirement | Loops (Part 4) | DFD element (Part 3) |
|---|---|---|
| FR-01/02/03 ingestion | Loop 1 (basic) → Loop 2 (hybrid index) → Loop 3 (multi-tenant) | P1.1–P1.4, D1, D2 |
| FR-03/04/05/06 query path | Loop 2 (optimization) → Loop 3 (SLA) | P2.1–P2.5 |
| FR-07 | Loop 2 (design) → Loop 3 (enforcement + pen test) | D4, P2.2 pushdown |
| FR-08 | Loop 1 (basic log) → Loop 3 (WORM + Merkle + erasure) | D3, P2.5, P1.4 |
| NFR-01…07 | Baseline Loop 1 → hardened Loop 2 → SLA-guaranteed Loop 3 | all flows |
