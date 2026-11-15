---
title: "Operations Baseline - Workload, Performance & SLO Targets"
artifact_id: RAG-OPS-001
package_part: "operations"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase 8.1 — Workload, Baselines, and SLO Targets

## Scope
Baseline operational measurement for the **current local/in-memory implementation** using synthetic mock components. This establishes repeatable local micro-benchmark context only; it does **not** validate production performance, availability, scalability, or cost.

## Workload assumptions (current baseline)
- **Dataset:** `data/eval/golden-v0.1.0.json` (v0.1.0, 3 synthetic plain-text cases)
- **Execution mode:** sequential, single-process, in-process only
- **Pipeline path measured per query case:** chunking + deterministic mock embedding + in-memory upsert + retrieval (`topK=3`) + deterministic mock generation
- **Components/providers:** `MemoryVectorStore`, deterministic keyword-hash mock embedder (`mock-embed-v1`, dim 8), deterministic mock LM (`mock-lm-v1`)
- **Iterations:** 50 (150 total query-case executions)
- **Exclusions:** no external network calls, no real embedding/LLM providers, no persistent vector DB, no concurrency/load generation, no multi-tenant production traffic, no ingestion of large/rich corpora

## Measured baseline (actual, local)
**Run:** 2026-11-15T11:40:16.025Z (`node scripts/benchmark-smoke.mjs`)  
**Environment:** Node `v26.13.1`, Linux `x64`

| Metric | Measured result | Notes |
|---|---:|---|
| Retrieval latency (p50 / p95 / p99) | **0.0117 ms / 0.0504 ms / 0.2505 ms** | 150 samples; includes query embedding (mock) + in-memory vector query |
| Generation latency (p50 / p95 / p99) | **0.0039 ms / 0.0238 ms / 0.0552 ms** | 150 samples; deterministic mock model only |
| Approx. throughput | **~15,556.5 queries/sec** | Sequential loop wall time `9.642 ms` over 150 query-case executions; not concurrent load capacity |
| Failure rate | **0 / 150 (0.0)** | No errors observed in this controlled mock run |
| Cost per query | **Not measured** | No external paid providers/services used (deterministic local mocks)

**Reproducibility:** build outputs in `dist/` then run `node scripts/benchmark-smoke.mjs` (uses `data/eval/golden-v0.1.0.json`).

## Limitations and interpretation
- Micro-benchmark on **tiny synthetic data (n=3)** with deterministic mocks; results primarily reflect in-process overhead, not real system behavior.
- **Not representative** of real embedding/LLM API latency, network/storage I/O, index size effects, serialization, retries/rate limits, authn/authz overhead at scale, or production failure modes.
- No concurrent users/load, no persistent/distributed vector store, no region/cross-AZ behavior, and no cost telemetry.
- These numbers **must not** be used to claim production SLO compliance, scalability, availability, or cost efficiency.

## SLO and operational targets (unvalidated)
Enterprise/target objectives from `docs/01_requirement_analysis.md` / `docs/03_spiral_sdlc_plan.md` remain **targets only** until implemented and measured under representative conditions:
| Target area | Stated target (unvalidated) | Current status |
|---|---|---|
| End-to-end latency | P95 < 800 ms (enterprise target; per-stage budgets in docs) | **Not validated** (only local mock micro-latency measured) |
| Availability | 99.9% monthly, RTO/RPO targets (enterprise) | **Not validated** (no production deployment/monitoring) |
| Scale/throughput | 10M+ documents, sustained QPS targets (enterprise) | **Not validated** (in-memory smoke only) |
| Retrieval quality | Recall@10/MRR/nDCG/faithfulness targets in docs | **Partially smoke-measured only** on synthetic n=3 mock baseline (`Recall@3=1.0`, `MRR=1.0`); not production/domain evidence |
| Cost | Infra/LLM monthly caps in enterprise docs | **Not measured** (no real provider/infra usage) |
| Multi-region/residency/DR | Region pinning, failover, DR targets | **Not implemented/validated** |

## Operational risks (current)
- **Representativeness gap:** real provider/network/index behavior may dominate latency and failure rates.
- **Scalability unknowns:** memory footprint, indexing/query behavior, and concurrency limits untested beyond smoke scale.
- **Reliability unknowns:** no production observability, alerting, retries/backpressure tuning at load, or failover evidence.
- **Cost unknowns:** embedding/LLM/storage/egress costs unmeasured; external usage requires authorization.
- **Security/compliance dependencies:** production operation depends on unverified controls (authn boundary enforcement, audit logging, residency, erasure workflows).

## Next steps (Phase 8.2/8.3 inputs)
- Add privacy-conscious structured logging/metrics hooks and runtime controls (timeouts/retries/concurrency/backpressure) consistent with architecture.
- Define representative workload models and repeatable benchmark scenarios (including concurrency and, if authorized, real provider/store integrations) before making performance claims.
- Document deployment/config assumptions and observable failure modes; keep all claims evidence-backed.