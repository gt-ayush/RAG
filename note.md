# Retrieval-Augmented Generation (RAG) — Production Reference Guide

## 1. Executive Summary

Retrieval-Augmented Generation (RAG) is an LLM augmentation pattern that injects externally retrieved, factual context into the prompt before generation, solving the core bottleneck of **parametric knowledge staleness and hallucination** inherent in frozen foundation models. It decouples knowledge storage from model weights, enabling updatable, auditable, domain-specific QA without retraining. In production, RAG reduces hallucination rates by 40–60% compared to vanilla LLM pipelines while maintaining sub-second latency at scale.

## 2. Core Concepts & Technical Architecture

### 2.1 Vector Embeddings
- Maps text to **d-dimensional dense vectors** (d ∈ {768, 1024, 1536, 3072}) via transformer encoders (`text-embedding-3-large`, `bge-m3`, `e5-large-v2`).
- Metric space: **cosine similarity** or **dot product**; L2 used less frequently due to scale sensitivity.

### 2.2 Dense vs. Sparse Retrieval
| Type | Mechanism | Best For |
|---|---|---|
| **Dense** | Semantic embedding similarity (ANN) | Conceptual match, paraphrases |
| **Sparse** | Lexical token weighting (BM25, SPLADE) | Exact keyword, entity-heavy queries |
| **Hybrid** | Fusion of both (RRF, Conceptor) | Production-grade recall |

### 2.3 Semantic Chunking
- **Fixed-size**: Token count per chunk (e.g., 512 tokens, overlap 50).
- **Recursive**: Split by headings → paragraphs → sentences.
- **Semantic**: Embedding-density-based boundaries to preserve context coherence.

### 2.4 Cross-Encoder vs. Bi-Encoder
- **Bi-Encoder** (DPR, Mistral-Embed): Independent query/doc encoding → fast ANN search.
- **Cross-Encoder** (Cohere Rerank, BGE-Reranker): Joint query-doc attention → high precision, O(n·d²) cost, used **post-retrieval**.

### 2.5 Component Pipeline

```
[Documents] → Parser → Chunker → Embedder → Vector Store
                                                ↓
[Query] → Embedder → Retriever → Re-ranker → Context Merger → LLM → Response
```

## 3. Step-by-Step Mechanics & Workflow

### ASCII Sequence Diagram

```
USER
  │
  ▼
┌─────────────┐
│  Query      │
│  Parser     │ ──► query embedding
└──────┬──────┘
       │
       ▼
┌─────────────┐     top-K ids
│  Vector DB  │◄──── ANN search (cosine/IP)
│  (FAISS/    │
│   Pinecone) │
└──────┬──────┘
       │
       ▼
┌─────────────┐     re-ranked chunks
│  Re-ranker  │◄──── cross-encoder score
│  (Cohere/   │
│   BGE)      │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Prompt     │ ──► [System + Context + Query]
│  Assembly   │
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  LLM        │ ──► generated answer + citations
│  (GPT-4o/   │
│   Claude)   │
└──────┬──────┘
       │
       ▼
    USER
```

### Key Mathematical Formulations

**Cosine Similarity** (Dense Retrieval):

$$\text{sim}(q, d) = \frac{q \cdot d}{\|q\|\|d\|}$$

**BM25 Score** (Sparse Retrieval):

$$\text{BM25}(q, d) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot \frac{f(q_i, d) \cdot (k_1 + 1)}{f(q_i, d) + k_1 \cdot (1 - b + b \cdot \frac{|d|}{avgdl})}$$

where k₁ ∈ [1.2, 2.0], b ∈ [0.5, 0.75].

**Reciprocal Rank Fusion (RRF)** (Hybrid):

$$\text{RRF}(d) = \sum_{r \in \{dense, sparse\}} \frac{1}{k + \text{rank}_r(d)}, \quad k = 60$$

**Cross-Encoder Relevance**:

$$s(q, d) = \text{softmax}(\text{CE}([q] \oplus [d]))_1$$

## 4. Key Failure Modes, Edge Cases & Solutions

| # | Failure Mode | Root Cause | Engineering Fix |
|---|---|---|---|
| 1 | **Retrieval Noise** | Low embedding quality, irrelevant top-K | Hybrid retrieval + cross-encoder reranking (top-20 → top-5) |
| 2 | **Lost in the Middle** | LLM attention attenuation at mid-context | Place most relevant chunk at positions 0 and -1; use sliding window attention |
| 3 | **Context Poisoning** | Outdated/incorrect docs in vector DB | Versioned document store + TTL + checksum-based dedup |
| 4 | **Chunking Fragmentation** | Semantic boundaries split across chunks | Semantic chunking with sentence-boundary awareness + overlap ≥ 10% |
| 5 | **Vector Drift** | Embedding model mismatch between ingest/query | Lock model version; monitor embedding distribution drift (PCA + KL divergence) |
| 6 | **Query Ambiguity** | Single query ≠ multiple intent clusters | Query expansion (LLM paraphrase) + multi-query retrieval + union merge |

## 5. Practical Implementation & Production Code

```python
import asyncio
from typing import List, Optional
from dataclasses import dataclass, field
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("rag")

@dataclass
class Chunk:
    id: str
    text: str
    metadata: dict = field(default_factory=dict)
    embedding: Optional[List[float]] = None

@dataclass
class RetrievedDoc:
    chunk: Chunk
    score: float
    rank: int

class DocumentIngestor:
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def parse(self, raw_text: str) -> List[str]:
        paragraphs = [p.strip() for p in raw_text.split("\n\n") if p.strip()]
        chunks, buffer = [], []
        for para in paragraphs:
            buffer.append(para)
            if len(" ".join(buffer)) > self.chunk_size:
                chunks.append(" ".join(buffer))
                buffer = buffer[-1:]
        if buffer:
            chunks.append(" ".join(buffer))
        return chunks

class VectorStore:
    def __init__(self):
        self._index: List[Chunk] = []

    def add(self, chunks: List[Chunk]) -> None:
        self._index.extend(chunks)
        logger.info(f"Indexed {len(chunks)} chunks, total={len(self._index)}")

    def search(self, query_embedding: List[float], top_k: int = 5) -> List[RetrievedDoc]:
        results = []
        for i, chunk in enumerate(self._index):
            score = 1.0 / (1 + i * 0.1)  # mock cosine similarity
            results.append(RetrievedDoc(chunk=chunk, score=score, rank=len(results) + 1))
        results.sort(key=lambda x: x.score, reverse=True)
        return results[:top_k]

class Reranker:
    def rerank(self, query: str, docs: List[RetrievedDoc], top_n: int = 3) -> List[RetrievedDoc]:
        return docs[:top_n]  # placeholder for Cohere/BGE reranker

class RAGPipeline:
    def __init__(self, vector_store: VectorStore, reranker: Reranker):
        self.store = vector_store
        self.reranker = reranker

    async def query(self, question: str, query_emb: List[float]) -> dict:
        raw = self.store.search(query_emb, top_k=10)
        if not raw:
            return {"answer": "No relevant context found.", "sources": []}
        ranked = self.reranker.rerank(question, raw, top_n=3)
        context = "\n\n".join(r.text for r in ranked)
        answer = f"Synthesized answer from {len(ranked)} chunks."
        return {
            "answer": answer,
            "sources": [r.chunk.id for r in ranked],
            "context_preview": context[:300],
        }
```

### Evaluation Metrics (RAGAS)

| Metric | Target (Production) | Formula |
|---|---|---|
| **Context Precision** | > 0.80 | TP / (TP + FP) among retrieved |
| **Context Recall** | > 0.70 | TP / (TP + FN) of relevant docs |
| **Faithfulness** | > 0.85 | NLI entailment score |
| **Answer Relevance** | > 0.80 | Query-answer semantic similarity |

## 6. Quick-Reference Cheat Sheet

### RAG Paradigms Comparison

| Paradigm | Latency | Accuracy | Complexity | Cost | Best For |
|---|---|---|---|---|---|
| Naive RAG | Low (50-200ms) | Medium | Low | Low | Prototypes, simple QA |
| Advanced RAG | Medium (200-500ms) | High | Medium | Medium | Enterprise search, compliance |
| Modular RAG | Medium-High | High | High | Medium | Multi-source, multi-modal |
| Agentic RAG | High (1-5s) | Highest | Very High | High | Complex research, multi-step |
| GraphRAG | High (2-8s) | High (entity-centric) | Very High | High | Knowledge-graph domains |
| Self/CRAG | Medium | High (self-correcting) | High | Medium | High-stakes, low-tolerance |

### Parameter Cheat Sheet

| Parameter | Typical Value | Notes |
|---|---|---|
| Chunk size | 256–1024 tokens | Larger = more context, worse precision |
| Chunk overlap | 10–25% | Prevents boundary fragmentation |
| Retriever top-K | 5–20 | Trade recall vs. noise |
| Re-ranker top-N | 3–5 | Post-filter precision boost |
| RRF k | 60 | Standard fusion constant |
| BM25 k₁ | 1.2–2.0 | Term frequency saturation |
| BM25 b | 0.5–0.75 | Document length normalization |
| Embedding dim | 768–3072 | Higher = better, costlier |
