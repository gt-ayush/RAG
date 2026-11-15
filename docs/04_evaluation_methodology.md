---
title: "Evaluation Methodology - RAG Baseline"
artifact_id: RAG-EVAL-001
package_part: "evaluation"
domain: General (synthetic baseline smoke set)
status: draft
version: 0.1.0
owner: Engineering
---

# Evaluation Methodology (Baseline)

## Purpose
Define a repeatable, honest methodology for evaluating the current repository RAG implementation. This document establishes dataset/versioning and metric/reporting conventions; **it does not report measured quality results by itself**.

## Dataset (versioned golden set)
- **Current dataset:** `data/eval/golden-v0.1.0.json`
- **Version:** `0.1.0` (`rag-golden-smoke`)
- **Created:** `2026-11-15`
- **Sample size:** 3 cases (synthetic smoke baseline)
- **Source:** synthetic examples authored for repository baseline testing; no external, customer, or regulated documents.
- **Contents:** plain-text documents, queries, provisional relevant document IDs, illustrative expected answers, and notes (including an insufficient-evidence case).

### Limitations (must be disclosed in every report)
- Tiny sample size; **not statistically meaningful** and **not evidence of production readiness**.
- Synthetic/plain-text only; excludes rich formats (PDF/HTML/DOCX/EML/XLSX), OCR/tables, multi-tenant data, financial-services/regulatory corpora, and real-world noise.
- Provisional relevance judgments/expected answers; no human adjudication study.
- Results from this set are for **smoke/regression checks** and pipeline wiring verification only.

## Evaluation scope and method
When running evaluations, record and report:
- **Dataset:** path/name, version, sample size, and any case filtering.
- **System under test:** commit hash (if available), component versions, and code path (ingest/chunk/retrieve/generate configuration).
- **Configuration:** chunk size/overlap, embedding model & dimensions, vector store/index settings, retrieval `topK`/filters/reranking, generation model/prompt version, and any timeouts/retries.
- **Environment:** runtime (Node/npm versions), local vs CI, and whether external providers/services were used (must be authorized; do not incur paid usage without approval).
- **Procedure:** deterministic steps/commands used, number of runs, and handling of failures/timeouts/empty results.

## Metrics (report only when actually measured)
### Retrieval
- **Recall@K:** fraction of cases where at least one relevant evidence item appears in top-K retrieved results.
- **MRR (Mean Reciprocal Rank):** average reciprocal rank of first relevant retrieved result.
- **nDCG@K:** rank-aware relevance quality (requires graded relevance if used; document grading scheme).
- **Context precision/recall (RAG-specific):** proportion of retrieved context that is relevant / relevant context retrieved (define judgment method).

### Generation / grounding
- **Faithfulness/groundedness:** degree to which answer claims are supported by retrieved evidence (define judging method: human, rubric, or automated; report limitations).
- **Answer relevance:** whether the response addresses the query (define judging method).
- **Citation correctness/traceability:** citations refer to real retrieved sources/chunks and support the associated claims (where evaluated).

### System/operational (if measured)
- **Latency:** per-stage/end-to-end (p50/p95/p99), sample size, and measurement method.
- **Failure rates:** parse/retrieval/generation/provider errors and timeouts.
- **Cost per query:** token/request costs only when provider usage/cost data is actually observed and reported.

## Reporting requirements
- Never fabricate results, benchmarks, baselines, or statistical significance.
- State dataset version, sample size, configuration, and exact method alongside any numbers.
- Distinguish measured results from targets/plans; do not extrapolate smoke-set results to production, compliance, or enterprise-scale readiness.
- Include known failures, exclusions, and non-determinism sources.
- For comparisons, use the same dataset version/configuration where possible and report differences explicitly.

## Current status
- **Baseline dataset created:** yes (`data/eval/golden-v0.1.0.json`, `v0.1.0`, 3 synthetic smoke cases).
- **Measured evaluation run recorded:** yes (Phase 6.2/6.3) — see `docs/05_evaluation_baseline.md` and `data/eval/baselines/golden-v0.1.0.baseline.json`.
  - **Method/config:** deterministic local mock embedding/generation, `chunkSize=200/overlap=0`, `MemoryVectorStore`, `topK=3`, separate retrieval+generation passes (`npm run evaluate` / `tests/eval.smoke.test.ts`).
  - **Measured (synthetic smoke, n=3):** Retrieval `Recall@3=1.0`, `MRR=1.0`; Generation `insufficientContextCases=1` (`smoke-003`).
  - **Not measured:** nDCG@K, human-judged faithfulness/answer relevance, context precision/recall, latency percentiles, real provider error/cost behavior.
- **Interpretation:** smoke/regression baseline only; **not** statistically meaningful and **not** evidence of production, domain, or enterprise quality/readiness. Future runs must record dataset version, config, method, environment, and any deviations before comparison.
