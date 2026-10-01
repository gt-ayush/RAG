---
title: "Spiral SDLC Plan - Enterprise RAG"
artifact_id: RAG-SDLC-001
package_part: "4 of 4"
lifecycle_model: "Spiral (Boehm)"
loops: 3
quadrants_per_loop: 4
loop_scope:
  - "Loop 1: Naive RAG Proof-of-Concept"
  - "Loop 2: Advanced RAG Optimization"
  - "Loop 3: Production Enterprise RAG"
status: draft
version: 0.1.0
owner: Platform Architecture
---

# Part 4 - Spiral SDLC Plan (3 Loops x 4 Quadrants)

**Spiral posture summary**

| Loop | Theme | Budget envelope | Duration | Exit gate |
|---|---|---|---|---|
| 1 | Naive RAG Proof-of-Concept | ~$2K infra + salaries | 4 weeks | Recall@5 ≥ 0.60, P95 < 2 s, faithfulness ≥ 0.70 |
| 2 | Advanced RAG Optimization | ~$8K/month infra | 8 weeks | Recall@10 ≥ 0.85, P95 < 800 ms @ 200 QPS, 0 RBAC leaks |
| 3 | Production Enterprise RAG | ≤ $15K/month infra | 12 weeks | 99.9% in 30-day burn-in, 0 critical findings, SOC 2 evidence complete |

Risk scoring: Likelihood (L) and Impact (I) on 1–5 scale; Risk Score = L × I; ≥ 15 = must-mitigate before exit gate.

---

## Loop 1 — Naive RAG Proof-of-Concept

### Quadrant I — Objectives, Alternatives, Constraints

**Objective.** Validate end-to-end feasibility: ingest 10K representative documents, retrieve with dense-only ANN, generate cited answers; establish baseline metrics (Recall@5, P95 latency, faithfulness) and select the embedding model and chunking strategy with evidence, not opinions.

**Alternatives evaluated**

| Alt | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | Framework-assisted naive chain (retriever + prompt template) | Fastest to first demo | Abstraction hides pipeline internals; tuning levers limited | **Selected** for PoC speed |
| B | Custom Python service + flat ANN index | Full control, zero abstraction | Slower; flat index is O(n) — fine at 10K, not at 10M | Deferred to Loop 2 re-evaluation |
| C | Managed vector SaaS end-to-end | Zero ops | Violates constraint C-T2 (vendor lock-in / data control); adds egress cost | **Rejected** |

**Constraints.** 4-week hard sprint; 2 engineers; single tenant; open-source + one managed LLM endpoint only; 10K-document sample skewed to PDF filings; no RBAC, no audit store (in-memory log acceptable for PoC).

### Quadrant II — Risks Identified & Resolved

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| R1.1 | Poor chunking quality degrades retrieval | 4 | 4 | 16 | Benchmark 3 strategies (fixed / recursive / semantic) on 500-query labeled subset; pick by F1 | Re-chunk corpus overnight (flat index rebuild ≤ 2 h at 10K docs) |
| R1.2 | Embedding model mismatch to financial vocabulary | 3 | 3 | 9 | Evaluate 2 candidate models offline on Recall@10 before committing | Swap model + re-embed (cheap at PoC scale) |
| R1.3 | LLM hallucination on financial data | 4 | 5 | 20 | NLI-based groundedness check; auto-reject answers with faithfulness < 0.70 | Refusal fallback message; restrict query scope to ingested corpus |
| R1.4 | PDF extraction failures (scanned / tabular) | 3 | 3 | 9 | OCR fallback for non-text layers; table-aware parser | Exclude unreadable docs from PoC corpus; log extraction-fail rate |
| R1.5 | Scope creep toward production features | 3 | 3 | 9 | Feature freeze: PoC = ingest + query + answer only; all tickets otherwise parked | Architect veto on PoC tickets |

### Quadrant III — Engineering, Development, Testing

- **Ingestion**: PDF-first parser (layout-aware, OCR fallback) → recursive chunking (512 tokens / 50 overlap) → 1,536-dim embeddings → flat ANN index (no HNSW at 10K scale).
- **Query**: embed query → top-5 cosine → template-prompted generation with mandatory citation instruction → NLI faithfulness check → emit answer or refusal.
- **Instrumentation**: per-stage latency counters, answer log (in-memory, exported nightly), golden-set runner (500 QA pairs, 10K-doc corpus).
- **Tests**: chunk-boundary unit tests (no orphaned sentences, overlap correctness); embedding-dimension consistency test; 500-query integration harness capturing Recall@5, P50/P95 latency, faithfulness.
- **Environments**: single ECS/Fargate service + RDS-less flat index on ephemeral storage; S3 source bucket (non-WORM, PoC only).

### Quadrant IV — Evaluation & Next-Phase Planning

**Exit criteria (measured on golden set).**

| Metric | Target | Actual (fill at gate) |
|---|---|---|
| Recall@5 | ≥ 0.60 | — |
| P95 end-to-end latency | < 2.0 s | — |
| Faithfulness (sampled, n = 200) | ≥ 0.70 | — |
| Extraction success rate | ≥ 95% | — |
| Critical defects | 0 | — |

**Decision rule.** Proceed to Loop 2 if all targets met; if Recall@5 ∈ [0.50, 0.60), run one remediation sub-sprint (chunking/embedding re-selection, ≤ 2 weeks) then re-gate; if < 0.50, reassess corpus sampling or reconsider dense-only assumption.
**Loop 2 planning inputs**: chosen embedding model + chunk strategy; measured retrieval-quality gap; latency budget breakdown by stage; cost-per-query baseline.

---

## Loop 2 — Advanced RAG Optimization

### Quadrant I — Objectives, Alternatives, Constraints

**Objective.** Close the quality-and-speed gap: Recall@10 ≥ 0.85 and P95 < 800 ms at 100 QPS on a full 1M-document corpus, via hybrid retrieval (dense + sparse, RRF fusion), cross-encoder re-ranking, metadata filtering, query expansion, and RBAC pre-retrieval enforcement.

**Alternatives evaluated**

| Alt | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | Qdrant (HNSW + native sparse vectors) + BGE re-ranker on EKS | One engine for both modalities; no lock-in (C-T2); filter pushdown | Ops burden: cluster tuning, HNSW params | **Selected** |
| B | Elasticsearch 8 hybrid (kNN + BM25) + external re-ranker | Mature ops ecosystem, strong BM25 | Dual-engine data sync; kNN tuning surface | Runner-up |
| C | Managed hybrid SaaS | Fast ops | Violates C-T2; per-node cost at 1M docs exceeds budget | **Rejected** |

**Constraints.** 8-week sprint; budget ≤ $8K/month infra; RBAC mandatory (design-time, even before multi-tenant launch); embedding model fixed from Loop 1 (no re-embed unless drift data proves it); latency budget allocation: policy lookup ≤ 10 ms, retrieval ≤ 150 ms, re-rank ≤ 120 ms, synthesis ≤ 30 ms, generation ≤ 450 ms.

### Quadrant II — Risks Identified & Resolved

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| R2.1 | RRF fusion mis-tuning silently harms quality | 3 | 4 | 12 | Grid-search RRF k (40/60/80) + per-modality weight sweep on held-out set; promote only on nDCG@10 lift | A/B shadow traffic: dual-index read, log-only compare |
| R2.2 | Re-ranker adds latency that breaks P95 budget | 4 | 3 | 12 | Limit candidate pool to top-20 into re-ranker; GPU-pinned re-ranker service; score cache for repeated contexts | Fall back to fused order (no re-rank) under load-shed |
| R2.3 | RBAC filter bypass / cross-tenant leakage | 2 | 5 | 10 | Filters translated server-side from signed claims (client never sends filter DSL); unit tests + 5,000-query red-team probe set | Auto-fail-closed: any policy-evaluation error blocks retrieval |
| R2.4 | Context window overflow on dense long answers | 3 | 4 | 12 | Dynamic chunk selection up to 32K-token budget; lowest-relevance chunks dropped first; truncation markers | Refuse with "context insufficient" rather than silently truncate |
| R2.5 | HNSW index memory blowup at 1M docs | 3 | 4 | 12 | HNSW M=16/efConstruction=200 for PoC-of-scale; monitor RAM vs. recall curve; shard collection by tenant later | Repartition + rebuild during maintenance window (dual index during cutover) |
| R2.6 | Query expansion cost/latency overrun | 3 | 2 | 6 | Cap at 3 paraphrases, 30-token budget each; skip expansion for short, unambiguous queries | Expansion off-switch in config (feature flag) |

### Quadrant III — Engineering, Development, Testing

- **Hybrid retrieval**: dense ANN (HNSW, cosine) + sparse BM25 postings in a single Qdrant collection; RRF fusion k = 60; filter pushdown (tenant, tier, date range, department).
- **Re-ranking**: BGE cross-encoder, top-20 → top-5, threshold 0.75, GPU node pool; circuit breaker to fused-order fallback.
- **Query path**: rewrite → decompose → ≤ 3 paraphrases → per-variant retrieval → union RRF.
- **RBAC**: policy store (OPA) + claims translation service; all retrieval queries carry server-built filter sets; 5,000-query cross-tenant probe suite in CI.
- **Evaluation harness v2**: golden set scaled to ≥ 1,000 QA pairs; weekly shadow sampling of 10% production-equivalent traffic; nDCG/MRR/Recall dashboards.
- **Load testing**: Locust + k6, production-mirror topology, 100 → 200 → 500 QPS ramps; latency-budget assertion per stage; error-injection (index node kill, gateway timeout).
- **Security**: RBAC red-team probe run; prompt-injection test set (100 adversarial queries) — verifies injection never alters retrieval scope or policy enforcement.
- **Ops**: Terraform-managed Qdrant 3-node cluster on EKS; blue-green index cutover runbook; Prometheus per-stage histograms.

### Quadrant IV — Evaluation & Next-Phase Planning

**Exit criteria.**

| Metric | Target | Actual (fill at gate) |
|---|---|---|
| Recall@10 | ≥ 0.85 | — |
| MRR / nDCG@10 | ≥ 0.70 / ≥ 0.78 | — |
| P95 end-to-end @ 200 QPS | < 800 ms | — |
| Cross-tenant leakage probes | 0 / 5,000 | — |
| Prompt-injection scope escapes | 0 / 100 | — |
| Infra cost @ full load | ≤ $8K/month | — |

**Decision rule.** All gates green for 1 continuous week in staging → proceed to Loop 3. Any single gate miss → targeted remediation sprint (≤ 3 weeks) with re-gate; two consecutive misses → architecture review (revisit Alternative B).
**Loop 3 planning inputs**: multi-tenant isolation model (per-tenant collections vs. partition key); SOC 2 evidence design; WORM audit pipeline; GDPR erasure cascade design; SLA monitoring + SLO burn-rate alerting.

---

## Loop 3 — Production Enterprise RAG

### Quadrant I — Objectives, Alternatives, Constraints

**Objective.** Production-grade, multi-tenant, SOC 2 Type II–evidence-ready Enterprise RAG serving 10M+ documents at 99.9% availability, P95 < 800 ms at 200 QPS, with immutable audit (7-year), GDPR erasure ≤ 30 days, EU data residency in eu-west-1, and steady-state cost ≤ $15K/month.

**Alternatives evaluated**

| Alt | Description | Pros | Cons | Verdict |
|---|---|---|---|---|
| A | Self-hosted Qdrant on EKS (us-east-1 + eu-west-1 partitions) | Satisfies C-T2, C-T4; full control; per-tenant collections | Full ops ownership: HA, patching, capacity | **Selected** |
| B | Managed vector SaaS (Pinecone-class) | Minimal ops | Data-control + lock-in violation; egress cost at 10M docs; residency carve-outs opaque | **Rejected** |
| C | Hybrid: self-hosted US + managed EU | EU ops offload | Split-brain schema drift; two mental models; audit complexity | Rejected (revisit if EU ops cost > 30% of budget) |

**Constraints.** SOC 2 Type II audit window (evidence must exist 90 days pre-audit); GDPR: EU corpus only in eu-west-1, erasure ≤ 30 days, DPIA on file; $15K/month infra cap; Restricted-tier content never leaves self-hosted/VPC-pinned inference (C-L3); blue-green or canary only; 6 + 2 + 1 team ceiling (C-B3).

### Quadrant II — Risks Identified & Resolved

| # | Risk | L | I | Score | Mitigation | Contingency |
|---|---|---|---|---|---|---|
| R3.1 | Data residency violation (EU data in US region) | 2 | 5 | 10 | Region-pinned collections (eu-west-1 only for EU corpus); OPA policy block on cross-region write; quarterly residency scan | Auto-quarantine: affected corpus flagged read-only until repatriation |
| R3.2 | Audit log tampering / integrity dispute | 2 | 5 | 10 | S3 Object Lock (compliance mode) + per-block Merkle roots published to a signed external feed; 7-year retention | Forensic replay from Merkle chain; break-glass recovery runbook |
| R3.3 | Embedding drift degrades quality silently | 3 | 4 | 12 | Weekly KL-divergence monitor (trigger < 0.05); version-pinned models; shadow re-index on trigger | Auto-shadow A/B; re-index + cutover within maintenance window |
| R3.4 | Multi-tenant noisy-neighbor (one tenant floods QPS) | 3 | 3 | 9 | Per-tenant QPS/token quotas at gateway; K8s resource quotas + separate GPU pool isolation | Load-shed lowest-priority tenant first (priority matrix pre-agreed) |
| R3.5 | GDPR erasure incomplete (residual vectors) | 2 | 5 | 10 | Erasure pipeline: cascade delete D2 vectors + D1 objects + D4 policy refs; verification sweep (count = 0) written back to D3; 30-day SLA tracker | Manual verified purge + regulatory notification procedure if SLA at risk |
| R3.6 | SLA breach during demand spike / LLM outage | 3 | 4 | 12 | HPA on query services; circuit breaker degrades to retrieval-only mode (Q3b returned, no generation) with clear banner; multi-region LLM fallback | Incident playbook: 15-min mitigation target, error-budget alerts (fast/slow burn-rate) |
| R3.7 | LLM vendor outage or model deprecation | 2 | 4 | 8 | Gateway abstraction (C-T1); ≥ 2 validated fallback models; weekly synthetic canary queries | Auto-failover to fallback model; retrieval-only degradation as last resort |

### Quadrant III — Engineering, Development, Testing

- **Deployment**: Qdrant cluster (3 nodes, replicated, at-rest KMS encryption) on EKS per region; query services with HPA; re-ranker GPU pool; terraform-iac with drift detection.
- **Multi-tenancy**: per-tenant collections + shared embedding model; tenant claims → server-side filter sets; per-tenant quotas at gateway (QPS, tokens/day).
- **Audit & governance**: append-only S3 Object-Log with Merkle hashing; per-query synchronous capture (A1/A2 flows, ≤ 20 ms overhead each); 7-year retention; break-glass read path dual-controlled.
- **Erasure**: FR-08 cascade pipeline with verification sweep + audit-masking (retains action record, redacts content) — end-to-end tested per tenant weekly.
- **Observability**: Prometheus + Grafana SLO dashboards (NFR-01…07), CloudWatch alarm federation, drift monitor, per-tenant cost attribution; SLO burn-rate alerts wired to on-call.
- **Chaos engineering (quarterly)**: AZ loss, index node kill, LLM gateway timeout, erasure mid-flight, quota exhaustion; each with automated recovery verification.
- **Security validation**: annual penetration test (tenant isolation, injection, privilege escalation, SSRF); SOC 2 evidence automation (access reviews, change logs, monitoring screenshots → evidence vault); 100-query adversarial prompt-injection suite in CI (regression).
- **Resilience**: blue-green index cutover (dual-index read window ≤ 72 h); RPO ≤ 5 min via snapshot cadence; multi-AZ failover drill quarterly.

### Quadrant IV — Evaluation & Next-Phase Planning

**Exit criteria (30-day burn-in in production-equivalent environment).**

| Metric | Target | Actual (fill at gate) |
|---|---|---|
| Availability (30-day) | ≥ 99.9% | — |
| P95 end-to-end @ 200 QPS | < 800 ms | — |
| Recall@10 / MRR / nDCG@10 | ≥ 0.85 / 0.70 / 0.78 | — |
| Cross-tenant leakage (re-probe) | 0 / 5,000 | — |
| Critical/high security findings | 0 | — |
| GDPR erasure E2E test | 100% complete ≤ 30 days | — |
| Audit completeness (log loss) | 0 events | — |
| Steady-state infra cost | ≤ $15K/month | — |
| SOC 2 evidence pack | 100% control coverage CC4/CC6/CC7 | — |

**Decision rule.** Production GA declared only when all rows green for the full 30-day window; any red row → 1 remediation sprint + full re-burn for that control (audit clocks reset per SOC 2 evidence rules).
**Post-GA roadmap (next spiral expansions)**:
1. **GraphRAG** — entity/relation index over regulatory citations for entity-centric and lineage queries (meets nDCG target on 200-query graph-QA subset).
2. **Agentic RAG** — multi-step tool use (fetch filing → compare versions → summarize deltas) with the same audit + RBAC enforcement surface; advisory-only per O-2.
3. **Cost optimization** — semantic query cache for high-repetition analyst queries (target: −25% LLM token spend), adaptive re-rank skipping for high-confidence single-source queries.
4. **Corpus expansion** — 50M documents via collection sharding by tenant + tier; recall/latency re-baselined before any sharding cutover.
