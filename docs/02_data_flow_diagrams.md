---
title: "Data Flow Diagrams - Enterprise RAG"
artifact_id: RAG-DFD-001
package_part: "3 of 4"
notation: "Mermaid.js (flowchart)"
diagrams: ["Level 0 Context Diagram", "Level 1 Decomposed Data Flow"]
domain: Financial Services
status: draft
version: 0.1.0
owner: Platform Architecture
---

# Part 3 - Data Flow Diagrams (DFD Level 0 & Level 1, Mermaid.js)

**Notation conventions**

| Symbol | Meaning |
|---|---|
| Double circle `(( ))` | External entity (human actor / external system) |
| Rounded rectangle `[ ]` | Process (numbered P1.x / P2.x, Level 1) |
| Cylinder `[( )]` | Data store (numbered D1–D4) |
| Labeled arrow `-- "Q1" -->` | Data flow (ID, payload description) |
| Subgraph boundary | Process group / system boundary |

Data flow IDs follow the `Qn` (query path), `In` (ingestion path), `An` (audit path) conventions and are inventoried in §3.3.

## 3.1 DFD Level 0 — Context Diagram

Single process (P0 = the entire Enterprise RAG System) and its external entities. Exactly one process, per standard DFD Level 0 convention.

```mermaid
flowchart LR
    %% ============ External entities ============
    EW["Enterprise User (Knowledge Worker)"]
    AD["System Administrator"]
    CO["Compliance Officer / Internal Auditor"]
    DS["Document Sources (S3 Lake, DMS, SharePoint, EDGAR, Email Archive)"]

    %% ============ The single system process ============
    P0[["P0<br/>Enterprise RAG System"]]

    %% ============ Data flows ============
    EW -- "Q1: Natural-language query + user/tenant identity" --> P0
    P0 -- "Q4: Grounded answer + source citations + confidence scores" --> EW
    AD -- "I0: Ingestion triggers, tenant onboarding, RBAC policies" --> P0
    P0 -- "I6: Ingestion status, index health, error receipts" --> AD
    DS -- "I1: Raw documents (PDF, HTML, DOCX, EML) + version metadata" --> P0
    P0 -- "I7: Retention actions + GDPR erasure directives" --> DS
    CO -- "A0: Audit review requests, retention & erasure requests" --> P0
    P0 -- "A1: Immutable audit records (query, retrieval, response trail)" --> CO
```

## 3.2 DFD Level 1 — Decomposed Data Flow

Decomposition of P0 into the **Ingestion Pipeline** (P1.1–P1.4) and the **Query & Generation Pipeline** (P2.1–P2.5), with data stores D1–D4.

```mermaid
flowchart TB
    %% ============ External entities ============
    U(("Enterprise User"))
    A(("System Administrator"))
    C(("Compliance Officer"))
    DS(("Document Sources (S3 / DMS / SharePoint)"))

    %% ============ Data stores ============
    D1[("D1<br/>Raw Document Store<br/>(S3, WORM-capable)")]
    D2[("D2<br/>Vector Index<br/>(Qdrant: HNSW dense + BM25 sparse)")]
    D3[("D3<br/>Immutable Audit Log<br/>(write-once + Merkle hashing)")]
    D4[("D4<br/>RBAC / Policy Store")]

    %% ============ P1: Ingestion pipeline ============
    subgraph P1G["Process 1.0 - Document Ingestion Pipeline"]
        direction LR
        P11["P1.1<br/>Parse &amp; Extract<br/>(layout-aware, OCR fallback)"]
        P12["P1.2<br/>Chunk &amp; Enrich<br/>(512 tokens, 10% overlap, metadata)"]
        P13["P1.3<br/>Embed<br/>(1536-dim, version-pinned)"]
        P14["P1.4<br/>Index &amp; Store<br/>(HNSW upsert + sparse tokens)"]
        P11 --> P12
        P12 --> P13
        P13 --> P14
    end

    %% ============ P2: Query & generation pipeline ============
    subgraph P2G["Process 2.0 - Query &amp; Generation Pipeline"]
        direction LR
        P21["P2.1<br/>Query Transform<br/>(rewrite, decompose, expand)"]
        P22["P2.2<br/>Hybrid Retrieve<br/>(ANN + BM25, RRF k=60, filter pushdown)"]
        P23["P2.3<br/>Re-rank<br/>(cross-encoder, top-5, threshold 0.75)"]
        P24["P2.4<br/>Context Synthesis<br/>(prompt assembly, token budget 32K)"]
        P25["P2.5<br/>Generate<br/>(LLM gateway, guardrails, citations)"]
        P21 --> P22
        P22 --> P23
        P23 --> P24
        P24 --> P25
    end

    %% ============ Ingestion data flows ============
    A -- "I0: Ingestion trigger / policy change" --> P11
    D4 -- "I2: Data classification + retention rules" --> P12
    D1 -- "I1: Raw documents + version metadata" --> P11
    P14 -- "I4: Embedded vectors + chunk metadata" --> D2
    P11 -- "I3: Parsed text + extraction status" --> D1
    P14 -- "I5: Ingestion events (success/failure/retry)" --> D3

    %% ============ Query data flows ============
    U -- "Q1: Query + user/tenant identity" --> P21
    D4 -- "Q2: Tenant/role claims -&gt; index filter set" --> P22
    D2 -- "Q3: Fused top-60 candidate pool + scores" --> P23
    P23 -- "Q3b: Re-ranked top-5 + relevance scores" --> P24
    P24 -- "Q3c: Assembled prompt (context + budget)" --> P25
    P25 -- "Q4: Answer + citations + confidence" --> U

    %% ============ Audit flows ============
    P22 -- "A1: Retrieved candidate IDs + scores" --> D3
    P25 -- "A2: Query/response record (prompt hash + response)" --> D3
    C -- "A0: Audit review / erasure request" --> D3
```

## 3.3 Data Flow Inventory

| Flow ID | Source | Target | Payload | Frequency | Latency budget |
|---|---|---|---|---|---|
| I0 | System Administrator | P1.1 | Ingestion trigger, channel config, policy update | On-demand / scheduled | — |
| I1 | D1 / Document Sources | P1.1 | Raw document bytes + source version ID | Event-driven (S3) / batch (hourly feeds) | — |
| I2 | D4 | P1.2 | Classification tier, retention rules, tenant mapping | Per document batch | &lt; 50 ms |
| I3 | P1.1 | D1 | Parsed text, table structures, extraction status, page map | Per document | — |
| I4 | P1.4 | D2 | Dense vectors (1536-d), sparse BM25 postings, chunk metadata | Per chunk | — |
| I5 | P1.4 | D3 | Ingestion events: doc ID, status, latency, retries | Per document | — |
| I6 | P0 | System Administrator | Ingestion status, index health, error receipts | Polling / alerts | — |
| I7 | P0 | D1 / Document Sources | Retention deletions, GDPR erasure directives | On request (≤ 30 days) | — |
| Q1 | Enterprise User | P2.1 | Natural-language query + authenticated user/tenant identity | Per user query | &lt; 10 ms transport |
| Q2 | D4 | P2.2 | Tenant/role claims translated to index filter set | Per query | &lt; 10 ms |
| Q3 | D2 | P2.3 | Fused top-60 candidate pool + per-source scores | Per query | &lt; 150 ms |
| Q3b | P2.3 | P2.4 | Re-ranked top-5 + relevance scores | Per query | &lt; 120 ms |
| Q3c | P2.4 | P2.5 | Assembled prompt (context, system policy, budget ≤ 32K tokens) | Per query | &lt; 30 ms |
| Q4 | P2.5 | Enterprise User | Grounded answer + citations (doc ID, page/offset, chunk ID) + confidence | Per query | end-to-end P95 &lt; 800 ms |
| A0 | Compliance Officer | D3 | Audit review query, retention/erasure request | On demand | — |
| A1 | P2.2 | D3 | Retrieved candidate IDs, scores, applied filters | Per query, synchronous (≤ 20 ms overhead) | &lt; 20 ms |
| A2 | P2.5 | D3 | Query/response record: identity, prompt hash, response, model + embedding versions | Per query, synchronous | &lt; 20 ms |

## 3.4 Data Store Registry

| Store | Technology (per §2.5 C-T2) | Retention | Integrity controls |
|---|---|---|---|
| D1 Raw Document Store | S3 (WORM object-lock buckets for regulatory content) | Per classification tier: 7–30 years | Object versioning, SHA-256 manifest, KMS AES-256-SSE |
| D2 Vector Index | Qdrant on EKS (HNSW M=32, efSearch=128 + sparse vectors), 3-node replication | Correlates to D1; rebuildable | Tenant-partitioned collections, at-rest encryption, snapshot restore (RPO ≤ 5 min) |
| D3 Immutable Audit Log | S3 Object Lock (compliance mode) + Merkle root publication | 7 years (SOC 2) minimum | Append-only, per-block Merkle hashing, WORM, access via break-glass procedure |
| D4 RBAC / Policy Store | Policy-as-code repository + OPA evaluation service | Per policy lifecycle | Signed policy bundles, dual-admin approval, change audit to D3 |
