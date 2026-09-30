# RAG — Retrieval-Augmented Generation

A TypeScript-based RAG (Retrieval-Augmented Generation) project for building intelligent, source-grounded AI applications.

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
├── tests/              # Unit & integration tests
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
| Qdrant | 🔜 Planned |
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
