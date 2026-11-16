# RAG — Retrieval-Augmented Generation

A TypeScript-based RAG (Retrieval-Augmented Generation) project with a **working baseline library implementation** (ingestion/chunking, embedding/store abstractions, retrieval, grounded generation helpers, evaluation, and security/operations documentation) and a separate **enterprise architecture & system analysis package** (target design, not implemented).

> **Status:** the repository currently provides modular TypeScript APIs and local/in-memory baselines (with synthetic/mock smoke evaluation). It does **not** implement a production service, real LLM/embedding/vector-database adapters, or enterprise compliance controls claimed in architecture docs.

## What is implemented now (baseline)

- **TypeScript foundation (ESM/NodeNext):** `src/` + `dist/` build, strict TS config, typed contracts, env/config validation (`.env.example`, `src/config.ts`).
- **Ingestion:** baseline text parsing (`.txt`, `.md`, `.markdown`, `.text`) with explicit `ok/empty/unsupported/error` outcomes, deterministic chunking with size/overlap validation, traceable metadata/offsets, content hashes, and idempotent batch behavior (`src/ingest.ts`).
- **Embeddings & indexing:** provider/store interfaces, model/dimension/vector validation, resilience/retry helpers, and in-memory vector store with idempotent upsert, document deletion lifecycle, and traceable query results (`src/embeddings.ts`, `src/vector-store.ts`, `src/memory-store.ts`, `src/resilience.ts`).
- **Retrieval:** baseline query embedding + vector retrieval, optional reranker hook, and trusted server-side authorization hooks (tenant/document allow-list, fail-closed policy evaluation when provided) (`src/retrieve.ts`).
- **Generation:** grounded prompt assembly with system/user/evidence isolation, untrusted-evidence instructions, citation restriction to retrieved sources, insufficient-context handling, and provider robustness controls (timeout, malformed-response checks, expected-model fail-closed, no silent fallback) (`src/generate.ts`).
- **Evaluation (synthetic smoke):** versioned dataset and measured baseline with deterministic mocks (Recall@3/MRR and insufficient-context case), reproducible via `npm run evaluate` (`data/eval/*`, `docs/04_evaluation_methodology.md`, `docs/05_evaluation_baseline.md`).
- **Security/operations docs & primitives:** threat/control review, security tests, compliance gap assessment, local ops benchmark, runtime-controls review, privacy-conscious observability primitives (`docs/06`–`docs/10`, `scripts/benchmark-smoke.mjs`, `src/observability.ts`).

## Planned / not yet implemented

- Real embedding and LLM provider adapters invoked with real credentials (adapters exist; real usage requires explicit env config and authorization).
- Rich document parsing (PDF/HTML/DOCX/EML/XLSX/OCR/tables), hybrid sparse+dense retrieval, BM25/RRF, cross-encoder reranking, and measured quality improvements on representative datasets.
- Durable multi-tenant ACL enforcement beyond the gateway rate-limit/quota/RBAC scaffold, centralized audit/security logging, GDPR erasure cascade verification, data residency enforcement, and production SLO/HA/DR evidence.
- Enterprise architecture in `docs/01-03`/`plan.md` is a **target design** (Financial Services, AWS, SOC 2 Type II + GDPR, 10M+ docs) — not proof of implementation or compliance.
- The remaining work is tracked as forward phases (21–25: real-time streaming generation & citation verification, rich document ingestion & HTTP upload, hybrid retrieval & query expansion, distributed state & Prometheus metrics, live credential smoke suite & documentation sync) in `docs/11_phase_status_and_roadmap.md` and `AGENTS.md` §17.

## Project structure (current)

```text
RAG/
├── src/                         # TypeScript source (ESM)
│   ├── index.ts                 # Public exports
│   ├── types.ts                 # Shared domain/config/result types
│   ├── config.ts                # Env/config parsing & validation
│   ├── ingest.ts                # Parsing, chunking, batch ingestion
│   ├── embeddings.ts            # Embedding contracts/validation/helpers
│   ├── vector-store.ts          # Vector store contract
│   ├── memory-store.ts          # In-memory vector store (baseline)
│   ├── retrieve.ts              # Baseline retrieval + authz/reranker hooks
│   ├── generate.ts              # Grounded prompt/generation helpers
│   ├── resilience.ts            # Retry/resilience utilities
│   ├── observability.ts         # Privacy-conscious logging/metrics primitives
│   ├── eval.ts                  # Evaluation dataset/metric utilities
│   ├── llm-provider.ts          # OpenAI-compatible LLM provider adapter (Phase 10.3)
│   ├── qdrant-store.ts          # Qdrant Cloud vector store adapter (Phase 10.2)
│   ├── reranker.ts              # Deterministic lexical reranker (Phase 11.3)
│   ├── server.ts                # HTTP service boundary: /health, /ready, /query (Phase 15.1)
│   ├── cli.ts                   # Production entry point: config load, dep wiring, graceful shutdown (Phase 15.1)
│   ├── authorization.ts         # Tenant authorization policy, fail-closed (Phase 15.2)
│   └── runtime-controls.ts      # Concurrency limiter, circuit breaker, cache, rate limiter (Phase 15.2)
├── dist/                        # Build output (generated by `npm run build`)
├── tests/                       # Vitest test suite
├── data/eval/                   # Versioned golden dataset + baseline results
├── scripts/benchmark-smoke.mjs  # Local in-memory micro-benchmark (smoke)
├── scripts/smoke-live.mjs       # Opt-in end-to-end live smoke test (real providers, requires --force)
├── Dockerfile                   # Production container image (Phase 15.3)
├── docker-compose.yml           # Local development orchestration (Phase 15.3)
├── infrastructure/
│   ├── systemd/rag.service      # systemd unit (Phase 15.3)
│   └── k8s/                     # Kubernetes Deployment + Service (Phase 15.3)
├── docs/                        # Architecture, evaluation, security, ops docs
├── .env.example                 # Environment variable template (no secrets)
├── package.json
├── tsconfig.json
└── README.md
```

## Getting started

### Prerequisites

- Node.js (verified with v26.13.1)
- npm (verified with v12.2.2)

### Install and build

```bash
git clone https://github.com/gt-ayush/RAG.git
cd RAG
npm install
npm run build
```

### Configuration

Copy `.env.example` to `.env` and fill values only when integrating real providers/stores (do not commit secrets):

```env
# LLM Provider
LLM_API_KEY=
LLM_MODEL=

# Vector Database
VECTOR_DB_URL=
VECTOR_DB_API_KEY=

# Embedding Model
EMBEDDING_MODEL=

# Embedding provider (optional; OpenAI-compatible HTTP embeddings endpoint).
# Leave unset to use the mock/in-memory baseline until a real provider is configured.
EMBEDDING_BASE_URL=
EMBEDDING_DIMENSIONS=
EMBEDDING_API_KEY=
EMBEDDING_TIMEOUT_MS=
```

Config parsing/validation is available via `parsePipelineConfig`, `loadPipelineConfig`, and `loadPipelineConfigFromProcessEnv` (`src/config.ts`) and returns non-sensitive validation issues.

When `EMBEDDING_BASE_URL` is set, `src/config.ts` parses it plus the optional `EMBEDDING_DIMENSIONS`, `EMBEDDING_API_KEY`, and `EMBEDDING_TIMEOUT_MS` fields. These feed `src/embedding-provider.ts`, a generic OpenAI-compatible HTTP embeddings adapter (`HttpEmbeddingProvider`) that implements the existing `EmbeddingProvider` contract: model/version pinning, dimension validation, per-request timeout, bounded retries for transient 429/5xx, and fail-closed handling with no silent fallback. Provider SDK details stay inside the adapter; pipeline modules never call a vendor SDK directly.

When `LLM_BASE_URL` is set, `src/config.ts` parses it plus the optional `LLM_TIMEOUT_MS` field. These feed `src/llm-provider.ts`, a generic OpenAI-compatible HTTP chat completions adapter (`HttpLLMProvider`) that implements the existing `LanguageModel` contract: model pinning, per-request timeout, grounded prompt assembly (system/user/evidence), fail-closed handling with no silent model fallback, and no secret values in error messages.

`VECTOR_DB_URL` and `VECTOR_DB_API_KEY` configure the Qdrant Cloud cluster endpoint and database API key. `QDRANT_COLLECTION` names the Qdrant collection to write into (created on first upsert if it does not exist; `document_id` and `tenant_id` payload fields are indexed for strict-mode filtering). These feed `src/qdrant-store.ts`, the `QdrantStore` adapter implementing the existing `VectorStore` contract: deterministic chunk-id→UUID mapping, server-side payload-filter pushdown (tenant/document), idempotent upsert, delete-by-document-id, and fail-closed error handling.

### Integration tests (no paid quota)

`tests/integration-pipeline.test.ts` exercises the embed → store → retrieve pipeline end-to-end using mocked `fetch` responses (no paid provider quota). Run it as part of the normal test suite:

```bash
npm test
```

To add a new integration test, follow the existing pattern:
1. Mock `globalThis.fetch` with `vi.fn()` returning a shaped `Response`.
2. Construct the real `HttpEmbeddingProvider`, `MemoryVectorStore`, and call `retrieve()`.
3. Assert on the composed result, not on internal implementation details.

Do not add tests that call real provider APIs in the default suite — paid quota must not be consumed by CI.

## Usage (current API, baseline)

The project currently exports composable functions/types (not a `RAGPipeline` class). Example: ingest + chunk local text files, index into the in-memory store with a mock embedder, retrieve, and generate a grounded answer with a mock model.

```ts
import {
  ingestSources,
  MemoryVectorStore,
  retrieve,
  generateGroundedAnswer,
} from "./dist/index.js"; // or from src in a TS/ESM-aware setup

// 1) Ingest & chunk baseline text sources (.txt/.md)
const batch = await ingestSources(["./data/note.txt"], { chunkSize: 512, chunkOverlap: 50 });
const chunks = batch.chunks;

// 2) Embed + index (provide an EmbeddingProvider implementation; example shape)
const store = new MemoryVectorStore(3);
const embeddingProvider = {
  model: "mock-embed",
  dimensions: 3,
  async embedTexts(texts: readonly string[]) {
    return texts.map((_, i) => ({ chunkId: chunks[i]!.id, model: "mock-embed", dimensions: 3, vector: [1, 0, 0] }));
  },
};
const embeddings = await embeddingProvider.embedTexts(chunks.map((c) => c.content));
await store.upsert(chunks.map((chunk, i) => ({ chunk, embedding: embeddings[i]! })));

// 3) Retrieve (pass trusted server-side authz context in secured deployments)
const retrieved = await retrieve(
  { text: "What is our policy?", topK: 5 },
  { embeddingProvider, vectorStore: store },
  // { context: { tenantId: "tenant-a", allowedDocumentIds: [...] } }
);

// 4) Generate grounded answer (provide a LanguageModel implementation)
if (retrieved.ok) {
  const model = { model: "mock-lm", async generate() { return { text: "..." }; } };
  const answer = await generateGroundedAnswer({ query: "What is our policy?", context: retrieved.value }, { model });
  console.log(answer);
}
```

Notes:
- Baseline parsing supports text formats only; unsupported/empty/unreadable inputs are reported explicitly.
- Retrieval authz hooks fail closed when provided/evaluated, but callers must supply trusted server-side context in secured deployments.
- Mock providers above are illustrative; real provider/store adapters are not included.

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check (`tsc --noEmit`) |
| `npm test` | Run Vitest suite |
| `npm run evaluate` | Run synthetic smoke evaluation (`tests/eval.smoke.test.ts`) |
| `npm run smoke:live` | Opt-in end-to-end live smoke test against real providers (requires `--force` or `SMOKE_LIVE_FORCE=1`; may incur paid API usage) |

Local smoke benchmark (after build): `node scripts/benchmark-smoke.mjs` (records in-memory/mock micro-latency only).

## Deployment (Phase 15.3)

The RAG service can be run as a standalone HTTP server via `src/cli.js`. It reads all
configuration from environment variables (fail-closed: exits non-zero with a
non-secret message if required config is missing). No secrets are baked into the
image or logged.

### Build and run with Docker

```bash
docker build -t rag-service .
docker run -p 8080:8080 --env-file .env rag-service
```

### Local development with docker-compose

```bash
docker compose up --build
```

### systemd

See `infrastructure/systemd/rag.service`. Requires `/opt/rag/.env` (mode 0600) and
the built `dist/` tree.

### Kubernetes

See `infrastructure/k8s/rag-deployment.yaml` and `infrastructure/k8s/rag-service.yaml`.
Credentials are expected in a `rag-env` Secret referenced by `envFrom`.

### Endpoints

- `GET /health` — liveness (always 200 when the process is up)
- `GET /ready` — readiness (200 when embedding provider, vector store, and LLM are wired)
- `POST /query` — grounded retrieval + generation (requires valid config + authz when policy is configured)

Graceful shutdown: `SIGTERM`/`SIGINT` stops accepting new connections, drains
in-flight requests up to `SHUTDOWN_TIMEOUT_MS` (default 5000 ms), then closes.

## Evaluation and operations (measured, limited)

- **Dataset:** `data/eval/golden-v0.1.0.json` (v0.1.0, synthetic, n=3 smoke cases) — not statistically meaningful or production-representative.
- **Baseline results (deterministic mocks, in-memory):** Retrieval Recall@3 = 1.0, MRR = 1.0; generation insufficient-context handling observed for negative case. See `docs/05_evaluation_baseline.md`.
- **Local perf benchmark:** synthetic/mock in-memory micro-benchmark only (see `docs/08_operations_baseline.md`); not evidence of real provider/network/storage latency, throughput, cost, or SLOs.
- **Security/ops status:** see `docs/06_security_threat_control_review.md`, `docs/07_compliance_gap_assessment.md`, `docs/09_observability_runtime_controls.md`, `docs/10_deployment_cost_readiness.md`.

## Troubleshooting

- **`npm run build`/`typecheck` fails:** run `npm install`, ensure Node/npm meet prerequisites, and confirm `tsconfig.json`/`src/` are unchanged or consistent.
- **`TS18003` (no inputs) or module resolution issues:** ensure `src/` contains TypeScript files and build uses project config; ESM imports in TS use `.js` specifiers (NodeNext).
- **Config validation errors:** verify required env vars in `.env` (see `.env.example`); errors are non-sensitive and do not include secret values.
- **Parse returns `unsupported`/`empty`/`error`:** baseline supports `.txt/.md/.markdown/.text` only; check path, permissions, and content.
- **Unexpected retrieval results:** confirm embedding model/dimensions match store, `topK` is valid, and trusted authz/tenant/document filters are applied as intended.
- **Generation returns insufficient context/errors:** ensure retrieved evidence is provided, citations/outputs are grounded, expected model/timeout settings are correct, and provider responses are well-formed (for real adapters).
- **Benchmark/eval numbers differ:** synthetic/mock baselines are environment-sensitive; do not compare across config/dataset/method changes without documenting deltas.

## Enterprise architecture & system analysis package (target)

Production-grade **design** deliverables (not implemented): Financial Services domain, AWS (us-east-1 primary, eu-west-1 residency target), SOC 2 Type II + GDPR targets, 10M+ docs / P95 < 800 ms / 99.9% targets.

| Part | Deliverable | Location |
|---|---|---|
| 1 | `pathlib` docs-scaffolding script (idempotent, atomic writes; archived) | `note.md` § PART 1 (executed; removed from repo) |
| 2 | Requirement analysis | `docs/01_requirement_analysis.md` |
| 3 | DFD Level 0/1 (Mermaid.js) + inventory/store registry | `docs/02_data_flow_diagrams.md` |
| 4 | Spiral SDLC plan (3 loops × 4 quadrants) | `docs/03_spiral_sdlc_plan.md` |

Additional implemented-baseline docs: `docs/04_evaluation_methodology.md`, `docs/05_evaluation_baseline.md`, `docs/06_security_threat_control_review.md`, `docs/07_compliance_gap_assessment.md`, `docs/08_operations_baseline.md`, `docs/09_observability_runtime_controls.md`, `docs/10_deployment_cost_readiness.md`.

Phase status and forward roadmap: `docs/11_phase_status_and_roadmap.md` (completed baseline 0–20 with evidence, known limits).

## Contributing

1. Inspect relevant files and existing patterns before changing behavior.
2. Make the smallest safe change; add/update tests and docs as needed.
3. Run relevant checks (`npm run typecheck`, `npm test`, and `npm run evaluate`/build as applicable) and report results accurately.

## License

Licensed under the [BSD 3-Clause License](LICENSE).
