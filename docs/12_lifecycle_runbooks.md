---
title: "Lifecycle Runbooks - Ingestion, Erasure, Failover, Index Rebuild"
artifact_id: RAG-OPS-004
package_part: "operations"
status: draft
version: 0.1.0
owner: Engineering
---

# Phase 18.4 — Lifecycle Runbooks

## Scope

This document defines operational runbooks for the RAG document lifecycle: ingestion, erasure/GDPR deletion, failover, and index rebuild. These runbooks are **safe by default** — they describe procedures to follow, not commands to execute blindly. Per AGENTS.md §17, no destructive deletion, bulk re-indexing, infrastructure changes, or high-impact operations should be run without explicit confirmation of scope, target environment, tenant/document scope, backup state, and rollback steps.

These runbooks apply to the current repository implementation (local baseline: TypeScript/ESM modules, `MemoryVectorStore`, in-memory primitives). They are intended to be adapted when real persistent stores (e.g. Qdrant) and deployment infrastructure are wired in Phases 15–20.

## Safe operations policy (required before any high-impact action)

| Rule | Description |
|---|---|
| Explicit confirmation required | Destructive/high-impact operations (deletion/erasure, bulk re-index, vector-store reset/migration, schema changes, credential rotation with service impact, infrastructure/deployment changes) require explicit user confirmation. |
| Scope and rollback | Confirm target environment, tenant/document scope, expected impact, backup/snapshot state (if applicable), and rollback/recovery steps before acting. |
| Fail closed | If authorization, policy evaluation, residency/egress policy, or required configuration is unknown or failing, do not proceed. |
| No fabricated evidence | Do not claim erasure completion, audit integrity, residency compliance, SOC 2/GDPR compliance, SLO attainment, or performance metrics without implementation and verifiable evidence. |
| External services/cost | Obtain authorization before using external LLM/embedding/vector services or actions that may incur paid usage or transmit restricted data. |

---

## Runbook 1 — Document Ingestion

**Purpose:** Ingest new or changed source documents into the index deterministically and idempotently.

### When to use
- Onboarding a new document source.
- Re-ingesting a document after content change (detected via content hash mismatch).
- Initial bulk load of a corpus (only with explicit confirmation for bulk operations).

### Prerequisites
- Source files in supported baseline formats: `.txt`, `.md`, `.markdown`, `.text`.
- `npm install` completed; `npm run build` emits `dist/`.
- Embedding provider configured (real or mock) and model/dimension compatibility validated.
- Target vector store available and accessible.
- Trusted tenant/document authorization context resolved server-side (fail closed if missing).

### Procedure
1. **Discovery:** List source paths to ingest. Verify each file is a regular file with a supported extension; report unsupported/empty/unreadable files explicitly (do not silently drop).
2. **Re-index decision:** For each source, compute its content hash (SHA-256). Call `IngestionLifecycleTracker.shouldReindex(documentId, contentHash)`:
   - `new`: proceed to ingest.
   - `changed`: proceed to re-index (content hash differs from recorded).
   - `unchanged`: skip (idempotent — no duplicate indexed records).
3. **Parse + chunk:** `parseSourceFile(path)` → `chunkDocument(document, { chunkSize, chunkOverlap })`. Validate chunking options (chunkSize > 0, chunkOverlap < chunkSize). Report malformed or partially unreadable documents.
4. **Embed:** Embed chunks with the configured provider; validate model/dimensions match the store.
5. **Upsert:** Upsert `IndexedRecord` entries into the vector store (idempotent by chunk id). Record chunk→document mapping via `tracker.recordChunks()`.
6. **Track ingestion:** `tracker.recordIngestion(documentId, source, contentHash, chunkCount, version?)`.
7. **Audit:** Emit `ingestion.started` / `ingestion.completed` / `ingestion.error` audit events via the audit log.

### Verification
- `tracker.getSourceRecord(documentId)` returns the recorded source record.
- `tracker.traceChunkToSource(chunkId)` resolves a chunk back to its source.
- Store query returns expected chunks for the source document.

### Rollback
- Re-ingestion is idempotent by chunk id; re-running with the same content hash produces no duplicates.
- To remove a source, use the erasure runbook (Runbook 2).

---

## Runbook 2 — Document Erasure / GDPR Deletion

**Purpose:** Erase a document across all stores (D1 raw, D2 vector, D4 policy) with a verification sweep and auditable outcome.

### When to use
- GDPR right-to-erasure (Article 17) requests.
- Document retirement or access revocation.
- Document content change requiring removal of stale indexed chunks.

### Prerequisites
- Document ID and trusted tenant identity resolved server-side (fail closed if missing principal).
- Erasure service configured (`createErasureService(d2Store)` or equivalent persistent-store adapter).
- Residency policy checked before erasure if region rules apply (tenant data confined to configured region).
- Authorization: the requesting principal must be allowed to erase the target document (server-side policy evaluation).

### Procedure
1. **Validate input:** `documentId` is required and must be a non-empty string. Reject with 400 if missing or invalid.
2. **Resolve trusted tenant:** From the authorization principal (never from client input). Reject with 401 if missing.
3. **Enforce residency:** If a residency policy is configured, check that the target region matches the tenant's rule. Reject with 403 on mismatch.
4. **Audit `erasure.requested`:** Record documentId, tenantId, legalBasis (if provided), deadline (if provided).
5. **Execute cascade:** Call the erasure service across D1 (raw store), D2 (vector store), and D4 (policy store).
   - D2: `store.deleteByDocumentId(documentId)`.
   - D1/D4: record intent where programmatic deletion is not available in the baseline.
6. **Verification sweep:** Check D2 for residual chunks belonging to the document. If residual count > 0, mark `ok: false` and record the residual count.
7. **Audit `erasure.completed`:** Record ok, residualChunkCount, storeResults.
8. **Clear tracking:** `tracker.clearDocument(documentId)` only after successful deletion and zero residuals.

### Results
- `ok: true`, `residualChunkCount: 0` — erasure complete.
- `ok: false`, `residualChunkCount > 0` — erasure incomplete; investigate and re-run. Do not claim completion.

### Rollback / failure handling
- Store delete failure → `ok: false` with `store.d2.erasure` issue; tracking is NOT cleared; document remains indexed.
- Residual chunks found → `ok: false` with `verification` issue; tracking is NOT cleared.
- Re-run erasure after resolving store issues.

---

## Runbook 3 — Failover (Degraded Mode)

**Purpose:** Operate safely when the vector store, embedding provider, or LLM provider is unavailable or degraded.

### When to use
- Vector store unreachable or returning errors.
- Embedding/LLM provider timeouts, rate limits (429), or 5xx errors.
- Partial infrastructure loss (single AZ/node failure in multi-node topologies).

### Behavior (implemented in baseline)
- **Retrieval:** `retrieve()` continues on dense store failure per variant (skips failed variant, fuses remaining results). Sparse retrieval failure does not fail the whole query (dense-only fallback).
- **Embedding:** Provider errors surface as `Result` issues; no silent fallback to a different model.
- **Generation:** `generateGroundedAnswer()` returns `generation_error` on provider failure/malformed output; insufficient context handled explicitly.
- **Authorization:** Fail closed — policy evaluator throw or `ok:false` → authorization denied (403), never 200.
- **Rate limiting:** Per-tenant rate limit and quota enforced at the gateway before pipeline calls; 429 on exceedance.

### Procedure
1. **Detect:** Monitor `http_5xx`, `retrieval_error`, `generation_error`, `embedding_provider` errors via metrics/observability.
2. **Assess:** Determine whether the failure is store-level, provider-level, or network-level.
3. **Degrade:** The system automatically degrades to available modalities (dense-only if sparse fails; empty context if dense fails). Generation returns insufficient-context when no evidence retrieved.
4. **Alert:** On sustained errors, page on-call; do not silently switch to an unapproved model or provider.
5. **Recover:** When the store/provider returns healthy, resume normal operation. No manual re-index required unless data was lost.

### Rollback
- Fail-closed behavior means no incorrect data is returned during degradation.
- No rollback needed for transient failures; for persistent failures, follow Runbook 4 (index rebuild) if data integrity is in question.

---

## Runbook 4 — Index Rebuild

**Purpose:** Rebuild the vector index from source documents (zero-downtime where supported).

### When to use
- Embedding model change (requires full re-embed with new model/dimensions).
- Index corruption or data integrity concerns.
- Migration to a new vector store or collection.
- Major chunking strategy change.

### Prerequisites
- **Explicit confirmation** required for bulk re-indexing (destructive/high-impact).
- Source documents available and readable.
- New embedding model/dimensions validated against target store.
- Target store collection created (or existing collection compatible).
- Backup/snapshot of current index (if persistent store supports it).

### Procedure
1. **Plan:** Confirm scope (all documents or specific tenants/documents), target store, embedding model, dimensions, and expected chunk count.
2. **Backup:** Snapshot the current index/collection if the store supports it. Record the snapshot ID.
3. **Dual-write (zero-downtime, if supported):** Write new records to the target collection while keeping the source collection readable; verify parity before cutover.
4. **Re-ingest:** For each source document:
   - Re-parse, re-chunk, re-embed with the new model/dimensions.
   - Upsert into the target store (idempotent by chunk id).
   - Update `IngestionLifecycleTracker` record (new contentHash, version).
5. **Verify:** Query sample documents from source and target; compare chunk counts and content hashes. Verify `tracker.traceChunkToSource()` resolves correctly.
6. **Cutover:** Point the service at the target store. Update `VECTOR_DB_URL`/collection config. Restart the service if required.
7. **Decommission:** Retain the old index for a validation period (e.g. 7–30 days) before deletion.

### Rollback
- Revert `VECTOR_DB_URL`/collection config to the previous store.
- Restore from snapshot if data integrity issues are found.
- Do not delete the old index until the new index is fully verified.

---

## Configuration and environment notes

| Variable | Purpose | Default |
|---|---|---|
| `VECTOR_DB_URL` | Target vector store URL | Required for real store; `MemoryVectorStore` used in baseline |
| `VECTOR_DB_API_KEY` | Vector store API key | Optional |
| `QDRANT_COLLECTION` | Qdrant collection name | Required for Qdrant store |
| `EMBEDDING_MODEL` | Embedding model identifier | Required |
| `EMBEDDING_DIMENSIONS` | Expected embedding dimensions | Required to match store |
| `EMBEDDING_BASE_URL` | Embedding provider base URL | Optional |
| `LLM_MODEL` / `LLM_BASE_URL` | LLM model and endpoint | Required for generation |
| `PORT` / `HOST` | HTTP service bind address | `8080` / `0.0.0.0` |
| `SHUTDOWN_TIMEOUT_MS` | Graceful shutdown drain timeout | `5000` |

### Verification commands (run before/after runbook actions)
- `npm run typecheck` — TypeScript type-check (exit 0)
- `npm test` — Vitest suite (all tests pass)
- `npm run build` — Compile to `dist/` (exit 0)
- `npm run evaluate` — Synthetic smoke evaluation (regression guard)

### What is NOT covered (future phases)
- Durable persistence across restarts (in-memory only in baseline).
- Multi-region topology and cross-region write blocking beyond residency policy.
- Centralized audit log with WORM/Merkle integrity (in-memory audit log in baseline).
- Production SLOs, HA, DR, and multi-AZ failover drills.
