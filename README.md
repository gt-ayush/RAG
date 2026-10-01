# RAG — Retrieval-Augmented Generation

A TypeScript-based RAG (Retrieval-Augmented Generation) project for building intelligent, source-grounded AI applications.

This repository also contains the **Enterprise RAG Architecture & System Analysis Package** — a production-grade, 4-part design deliverable for the enterprise variant (Financial Services domain, AWS, SOC 2 Type II + GDPR, 10M+ documents). See [Enterprise Architecture & System Analysis Package](#enterprise-architecture--system-analysis-package).

## What is RAG?

**Retrieval-Augmented Generation (RAG)** enhances Large Language Models (LLMs) by retrieving relevant information from an external knowledge base before generating a response. Instead of relying solely on the model's internal training data, RAG grounds the model's answers in fresh, factual, and source-specific documents.

### Why RAG?

- **Reduces hallucinations** — Answers are grounded in real documents
- **Up-to-date knowledge** — No training cutoff; just update the knowledge base
- **Domain expertise** — Inject proprietary or niche data (medical, legal, code)
- **Source attribution** — Cite where every answer comes from
- **Cost-effective** — Cheaper than fine-tuning for most use cases

## Architecture

```
User Query → [Embed] → [Vector DB Search] → [Top-K Chunks] → [LLM Prompt] → Answer
                                  ↑
                            Knowledge Base
```

### Pipeline Stages

1. **Ingestion** — Parse documents → Chunk → Embed → Store in vector DB
2. **Retrieval** — Embed query → Find similar chunks → (Optional) Re-rank
3. **Generation** — Build prompt with context → LLM → Answer with citations

## Enterprise Architecture & System Analysis Package

Production-grade architecture & system analysis for the enterprise variant of this RAG system. The package is a 4-part engineering deliverable; `docs/` holds Parts 2–4 and `note.md` is a synced single-file working copy that also archives the Part 1 setup script (executed once to generate `docs/`, then removed from the repo at the owner's request).

**Parameters**

| Parameter | Value |
|---|---|
| Domain / Industry | Financial Services (contracts, filings, research, regulatory guidance) |
| Cloud / Infrastructure | AWS — us-east-1 primary (a/b/c), eu-west-1 for EU data residency |
| Security & Compliance | SOC 2 Type II + GDPR |
| Scale & SLA | 10M+ documents · P95 < 800 ms · 99.9% monthly availability |

**Deliverables**

| Part | Deliverable | Location |
|---|---|---|
| 1 | `pathlib` docs-scaffolding script (idempotent, atomic writes, logging, exit codes) | `note.md` § PART 1 (archived; scaffold already executed) |
| 2 | Requirement Analysis — scope & vision, human/system actors, 8 FRs, 7 quantitative NFRs, constraints | `docs/01_requirement_analysis.md` |
| 3 | DFD Level 0 (context) & Level 1 (decomposed) in Mermaid.js, + data-flow inventory & store registry | `docs/02_data_flow_diagrams.md` |
| 4 | Spiral SDLC plan — 3 loops × 4 quadrants (Naive PoC → Advanced Optimization → Production Enterprise) | `docs/03_spiral_sdlc_plan.md` |

Key architectural decisions: hybrid dense (HNSW/ANN) + sparse (BM25) retrieval with RRF fusion (k = 60), cross-encoder re-ranking (top-5, threshold 0.75), pre-retrieval RBAC/tenant filter pushdown, LLM-gateway abstraction (model-agnostic), self-hosted Qdrant on EKS (no proprietary vector SaaS), immutable WORM + Merkle audit logging, GDPR erasure cascade.

The scaffold was executed once to produce `docs/`. The Part 1 script (archived in `note.md` § PART 1) was removed from the repo at the owner's request; to regenerate or repair the scaffold, copy that script to `scripts/setup_docs.py` and run:

```bash
python3 scripts/setup_docs.py            # idempotent; skips existing files
python3 scripts/setup_docs.py --force    # reseed existing files to metadata stubs (destructive)
```

## Project Structure

```
RAG/
├── src/
│   ├── index.ts        # Entry point
│   ├── ingest.ts       # Document ingestion & chunking
│   ├── retrieve.ts     # Vector search & re-ranking
│   ├── generate.ts     # LLM prompt & response generation
│   └── types.ts        # Shared types & interfaces
├── data/               # Source documents
├── docs/               # Enterprise architecture & system analysis package (Parts 2–4)
│   ├── 01_requirement_analysis.md
│   ├── 02_data_flow_diagrams.md
│   ├── 03_spiral_sdlc_plan.md
│   └── assets/
├── tests/              # Unit & integration tests
├── note.md             # Synced working copy (archives Part 1 setup script)
├── package.json
├── tsconfig.json
└── README.md
```

## Getting Started

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Installation

```bash
# Clone the repository
git clone https://github.com/gt-ayush/RAG.git
cd RAG

# Install dependencies
npm install

# Build the project
npm run build
```

### Configuration

Create a `.env` file in the project root:

```env
# LLM Provider
LLM_API_KEY=your-api-key
LLM_MODEL=gpt-4o

# Vector Database
VECTOR_DB_URL=http://localhost:6333
VECTOR_DB_API_KEY=your-vector-db-key

# Embedding Model
EMBEDDING_MODEL=text-embedding-3-small
```

## Usage

```typescript
import { RAGPipeline } from "./src/index";

const rag = new RAGPipeline({
  model: "gpt-4o",
  embeddingModel: "text-embedding-3-small",
  vectorStore: "chroma",
});

// Ingest documents
await rag.ingest("./data", {
  chunkSize: 512,
  chunkOverlap: 50,
});

// Query
const answer = await rag.query("What is our company policy on remote work?");
console.log(answer.text);
console.log(answer.sources); // Cited documents
```

## Key Features

- **Multiple chunking strategies** — Fixed, recursive, semantic
- **Hybrid retrieval** — Dense (embedding) + Sparse (BM25)
- **Re-ranking** — Cross-encoder re-ranker for top-K precision
- **Source citation** — Every answer includes document references
- **TypeScript-first** — Full type safety and IDE support

## Supported Vector Databases

| Database | Status |
|---|---|
| Chroma | ✅ Supported |
| Pinecone | 🔜 Planned |
| Qdrant | 🎯 Enterprise target (self-hosted on EKS, see architecture package) |
| FAISS | 🔜 Planned |
| Weaviate | 🔜 Planned |

## Evaluation

RAG quality is measured using:

- **Faithfulness** — Is the answer grounded in retrieved context?
- **Answer Relevancy** — Does it answer the actual query?
- **Context Precision** — Are retrieved chunks relevant?
- **Context Recall** — Did we retrieve all necessary context?

Run evaluations with:

```bash
npm run evaluate
```

## Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript |
| `npm run dev` | Run in development mode (watch) |
| `npm start` | Run compiled output |
| `npm test` | Run test suite |
| `npm run evaluate` | Run RAG evaluation |

## Dependencies

- **Runtime**: TypeScript, vector DB client, LLM SDK
- **Dev**: Vitest, ESLint, Prettier

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Resources

- [What is RAG?](https://www.mongodb.com/developer/products/mongodb/rag-explained/) — MongoDB guide
- [LangChain RAG Docs](https://js.langchain.com/docs/concepts/rag/) — LangChain concepts
- [LlamaIndex RAG](https://docs.llamaindex.ai/) — Data framework for LLM apps
- [Ragas Evaluation](https://docs.ragas.io/) — RAG evaluation framework
