---
title: "Threat & Control Review - Baseline Implementation"
artifact_id: RAG-SEC-001
package_part: "security"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase 7.1 — Threat & Control Review (Baseline)

## Scope and evidence basis
This review is based on the **current repository implementation and configuration** (not enterprise target architecture). Evidence reviewed:
- `src/config.ts` (env/config boundary parsing/validation)
- `src/retrieve.ts` (retrieval orchestration, authorization hooks/filtering, reranker path)
- `src/generate.ts` (prompt assembly, grounding/citation handling, model invocation controls)
- `src/memory-store.ts`, `src/vector-store.ts`, `src/embeddings.ts` (in-memory indexing/query, compatibility/validation)
- `src/ingest.ts` (parsing/chunking/batch behavior)
- `tests/*` (config, ingest, chunking, embeddings/store, retrieval, generation, eval smoke), `.env.example`, `docs/01-05`, `README.md`
- Baseline checks: `npm test` (50 passing), `npm run typecheck`, `npm run build` as previously recorded

**Important:** no production deployment, real authentication service, durable vector DB, external LLM/embedding provider adapters, audit/log pipeline, or compliance controls are implemented in this repo. Enterprise controls in `docs/01-03`/`plan.md` are targets unless verified in code/operations.

## Trust boundaries and data flows (current)
| Boundary | Untrusted / external inputs | Trusted/internal components | Controls present (verified) | Notes/gaps |
|---|---|---|---|---|
| Configuration/env | `process.env` / env-like objects (`LLM_API_KEY`, `LLM_MODEL`, `VECTOR_DB_URL`, `VECTOR_DB_API_KEY`, `EMBEDDING_MODEL`) | `parsePipelineConfig` / `loadPipelineConfig` (`src/config.ts`) | Required-field and URL validation; `Result`/`ConfigValidationError` with non-sensitive issue messages (no secret values echoed) | No secret manager integration, rotation, encryption-at-rest/in-transit guarantees, or runtime least-privilege enforcement implemented |
| Source ingestion | Filesystem paths/content (baseline `.txt/.md/.markdown/.text`) | `parseSourceFile`, `chunkDocument`, `ingestSources` (`src/ingest.ts`) | Explicit statuses/issues for unsupported/empty/unreadable/non-file inputs; deterministic chunking/IDs/offsets; content-hash metadata; no document-content logging in module | No malware scanning, DLP/redaction, rich-format/OCR parsers, access checks on source paths, or provenance signing; path/content is otherwise untrusted |
| Embedding/indexing | Provider outputs, record payloads, query embeddings | `validateEmbeddingsForChunks`, `validateQueryEmbedding`, `MemoryVectorStore` (`src/embeddings.ts`, `src/memory-store.ts`) | Model/dimension/count/vector-finite validation; chunk/metadata ID consistency checks; idempotent upsert by chunk ID; traceability-preserving clones | In-memory only (non-durable), no encryption, no authn/authz on store operations, no rate limiting/backpressure, no multi-process isolation |
| Retrieval (pre-generation) | Query text, `topK`, client-supplied `tenantId`/filters, reranker output, policy evaluator behavior | `retrieve` (`src/retrieve.ts`) with optional `RetrievalAuthorization` | When `authz` provided: policy evaluation failure/throw **fails closed**; trusted tenant enforcement; client tenant without trusted tenant denied; tenant mismatch denied; document allow-list post-filtering; query/embedding validation; reranker errors surfaced | **If `authz` is omitted, `retrieve` does not invent permissions** but also does not enforce tenant/doc restrictions (secured deployments must always provide trusted server-side context). No built-in identity/authentication, RBAC/ABAC engine, or store-native ACL pushdown beyond tenant filter in memory store |
| Generation | Retrieved evidence content (prompt-injection risk), model outputs | `buildGroundedPrompt`, `generateGroundedAnswer` (`src/generate.ts`) | System/user/evidence separation; explicit untrusted-evidence instruction; empty/missing evidence -> insufficient-context; citation restriction to real retrieved chunks; malformed response rejection; optional timeout; `expectedModel` mismatch fails closed; provider errors surfaced (no silent fallback/alternate provider) | No real provider adapter hardening (transport TLS, provider allowlists, data egress controls, PII redaction, per-tenant quotas), no claim-level faithfulness verifier, no output safety classifier; prompts include retrieved content and will be sent to any configured model adapter |
| Evaluation/test data | Synthetic dataset files | `src/eval.ts`, `tests/eval.smoke.test.ts`, `data/eval/*` | Synthetic-only documented dataset; deterministic mock providers in smoke eval (no external calls) | Baseline metrics are mock/synthetic and non-representative (documented) |

## Control review by area

### 1) Authentication and authorization paths
- **Verified controls:** retrieval supports trusted authorization context and optional evaluator hook; denies client-tenant-only authorization, tenant mismatches, and evaluator failures/throws (fail closed). Document allow-list filtering applied to results before return. Prompt assembly treats evidence as untrusted and instructs non-override of policy/access controls.
- **Gaps/risks:** no user authentication, session/token validation, identity provider integration, RBAC/ABAC policy store, or service-to-service auth. Authorization is caller-supplied API discipline (not enforced by an identity boundary). Generation path has no separate authz gate (must only receive already-authorized retrieved context).

### 2) Server-side tenant/document filtering
- **Verified controls:** trusted `tenantId` passed to store query (`MemoryVectorStore` filters by `chunk.metadata.tenantId`); defensive post-filter for `allowedDocumentIds`; reranker operates on already-scoped results; `topK` re-applied after filtering/rerank.
- **Gaps/risks:** store filtering is in-memory equality check only (no durable index ACLs, attribute policies, row-level security, or audited filter translation). If `authz` omitted, no tenant isolation is enforced by `retrieve`. Client-provided filters in `RetrievalQuery` beyond trusted handling are not a complete authz mechanism.

### 3) Secret handling
- **Verified controls:** `.env.example` contains placeholders only; config validation does not include secret values in issues/errors; tests assert secret non-leakage in validation errors.
- **Gaps/risks:** `PipelineConfig` holds API keys in-memory as plain strings (expected for runtime use) with no redaction utilities, secret zeroization, vault/KMS integration, rotation workflow, or prevention of accidental logging by future callers/adapters. Real provider adapters must avoid logging prompts/credentials/responses containing sensitive data.

### 4) Logging
- **Verified controls:** ingestion/config/generation/retrieval modules do not intentionally log document contents or secrets; parsing returns structured issues; config errors are non-sensitive. (No centralized logging framework implemented.)
- **Gaps/risks:** no structured audit/security logging, redaction layer, or guarantees for downstream consumers/providers. `console.log` appears only in `tests/eval.smoke.test.ts` (test output). Future observability work must be privacy-conscious and exclude sensitive content/secrets by default.

### 5) Retention and deletion
- **Verified controls:** `VectorStore.deleteByDocumentId` contract and `MemoryVectorStore` implementation remove indexed chunks for a document; idempotent upsert supports re-indexing; batch ingestion reports outcomes/dedupes chunk IDs in-process.
- **Gaps/risks:** in-memory store is ephemeral (no persistence, backups, replication, or verified erasure across systems). No source-document retention policy enforcement, GDPR/DSAR workflows, audit-log retention/WORM, cascade deletion across object/vector/audit stores, or deletion verification evidence.

### 6) Provider data flows
- **Verified controls:** model interface abstraction (`LanguageModel`), prompt isolation, `expectedModel` fail-closed option, timeout handling, malformed-response rejection, and no silent alternate-provider fallback in `generateGroundedAnswer`. Embedding provider abstraction exists with compatibility validation and bounded-retry helper usage in `embedChunksWithValidation`.
- **Gaps/risks:** no concrete external provider adapters implemented; therefore no verified controls for endpoint allowlisting, TLS/mTLS configuration, regional residency, data minimization/redaction before egress, provider-side retention settings, or per-tenant/provider policy enforcement. When adapters are added, restricted data must not be sent to unapproved providers/regions.

## Fail-closed points (verified) vs required hardening
| Scenario | Current behavior | Status |
|---|---|---|
| Missing/invalid config | `parsePipelineConfig` returns issues / `loadPipelineConfig` throws non-sensitive error | Fail closed (config boundary) |
| Retrieval policy evaluation error/throw or denied result | `retrieve` returns authorization denial | Fail closed |
| Client supplies tenant filter without trusted tenant authz (when authz context provided) | Denied | Fail closed |
| Tenant mismatch (request vs trusted) | Denied | Fail closed |
| Unapproved generation model (`expectedModel`) | Generation denied before call | Fail closed |
| Generation timeout/provider exception/malformed output | Explicit error result (no fabricated answer) | Fail closed on correctness/safety path |
| No retrieved evidence | Explicit insufficient-context answer (no invention) | Safe fallback behavior |
| `retrieve` called without `authz` context | No tenant/doc restrictions applied by `retrieve` (caller responsibility noted) | **Not fail-closed by default**; requires secured integration contract |

## Priority gaps (Phase 7 follow-up)
1. **P0:** Define/enforce mandatory trusted authz context at service/API boundary (fail closed by default in secured deployments), plus authenticated identity integration.
2. **P1:** Add authorization and prompt-injection security tests for end-to-end pipeline paths and cross-tenant isolation scenarios (7.2).
3. **P1:** Introduce privacy-conscious structured logging/redaction guidance and avoid content/secret leakage in future adapters.
4. **P1:** Implement and verify deletion/retention semantics for any persistent store adapters (including cascade and evidence where required).
5. **P2:** Provider egress controls (approved models/endpoints/regions), data minimization/redaction, and residency-aware routing for real adapters.
6. **P2:** Formal compliance gap assessment (GDPR/SOC 2/audit immutability/residency) with verified evidence only (7.3).

## Conclusion
The baseline implementation includes **meaningful local safeguards** (config validation without secret leakage, retrieval authz hooks with fail-closed evaluation/tenant checks when used, document allow-list filtering, untrusted-evidence prompt isolation, citation restriction, and explicit failure/insufficient-context handling). However, it is **not a secured or compliant production system**: authentication, durable multi-tenant enforcement, audited logging, retention/erasure workflows, and real provider egress controls are not implemented and must be treated as gaps until verified.