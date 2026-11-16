---
title: "Evaluation Baseline Report - Golden Smoke v0.2.0"
artifact_id: RAG-EVAL-BASELINE-002
status: draft
version: 0.2.0
owner: Engineering
---

# Evaluation Baseline Report - Golden Smoke v0.2.0

## Scope

Recorded baseline measurement for the current in-repository RAG pipeline interfaces using the synthetic golden smoke dataset v0.2.0. This is a **regression/smoke baseline only**.

## Reproducibility

- **Command:** `npm run evaluate` (runs `vitest run tests/eval.smoke.test.ts`)
- **Dataset:** `data/eval/golden-v0.2.0.json` (`rag-golden-representative-smoke`, version `0.2.0`, sample size `10`)
- **Baseline record:** `data/eval/baselines/golden-v0.2.0.baseline.json`
- **Methodology:** `docs/04_evaluation_methodology.md`
- **Measured at:** 2026-11-16 (`runId: golden-v0.2.0-smoke-baseline-2026-11-16`)

## Configuration (measured run)

- **Chunking:** `chunkSize=200`, `chunkOverlap=0`
- **Embedding:** deterministic mock keyword-hash provider (`mock-embed-v1`, dimensions `8`, local/no external service)
- **Vector store:** `MemoryVectorStore` (in-memory)
- **Retrieval:** `topK=3`, no metadata filters, no reranker, dense-only path (no hybrid/sparse)
- **Generation:** deterministic mock language model (`mock-lm-v1`, local/no external service)
- **Procedure:** per case, synthetic documents ingested/chunked/embedded/upserted into an isolated in-memory store; retrieval and generation evaluated separately; automated assertions in `tests/eval.smoke.test.ts`

## Measured results (actual)

| Area | Metric | Result | Notes |
|---|---:|---:|---|
| Retrieval | Recall@3 | **1.0** (10/10) | Relevant evidence retrieved in top-3 for cases where relevant evidence exists; negative cases have no relevant evidence expected |
| Retrieval | MRR | **1.0** | First relevant result ranked 1 in applicable cases |
| Retrieval | nDCG@3 | **1.0** | Normalized discounted cumulative gain at K=3 |
| Generation | Insufficient-context cases | **2** (`smoke-003`, `smoke-006`) | Explicit insufficient-context handling observed for no-relevant-evidence cases |

**Not measured:** human-judged faithfulness/answer relevance, context precision/recall, latency percentiles, provider error rates under real services, cost per query, real embedding/LLM quality.

## Regression baseline usage

- `tests/eval.smoke.test.ts` acts as the automated regression guard for this dataset/configuration by asserting the recorded retrieval/generation outcomes.
- Any change to dataset, chunking, embedding/retrieval/generation logic, or configuration may legitimately change results; comparisons must report dataset version, config, and method differences and must not claim improvement without measured evidence.
- Known failure/safety behaviors guarded elsewhere in the suite (non-exhaustive): citation restriction to retrieved sources, insufficient-context handling, prompt-injection isolation in prompts, provider timeout/malformed/unapproved-model handling, and authorization fail-closed behavior.
- Dense-only retrieval path remains available and tested; hybrid/sparse retrieval requires explicit opt-in and is not the default.

## Delta vs v0.1.0

| Metric | v0.1.0 (n=3) | v0.2.0 (n=10) | Change | Interpretation |
|---|---:|---:|---:|---|
| Sample size | 3 | 10 | +7 | Dataset expanded for broader regression coverage |
| Recall@3 | 1.0 | 1.0 | 0.0 | No regression on deterministic mocks |
| MRR | 1.0 | 1.0 | 0.0 | No regression on deterministic mocks |
| nDCG@3 | 1.0 | 1.0 | 0.0 | No regression on deterministic mocks |

**Interpretation:** Delta indicates regression stability, not quality improvement. Both datasets are synthetic with deterministic mocks; results must not be extrapolated to production, domain, or enterprise-scale readiness.

## Limitations and interpretation

- **Small synthetic sample (n=10)** with deterministic mocks; **not statistically meaningful** and **not representative** of real documents, providers, or user queries.
- Results **must not** be interpreted as production, financial-services, compliance, or enterprise-scale quality/performance evidence.
- No external embedding/LLM/vector-database services were used; real-world behavior, latency, and cost remain unmeasured. If future runs require external services, authorization and usage/cost controls must be confirmed and reported.
