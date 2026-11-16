import { readFile } from 'node:fs/promises';
import type { RetrievalResult } from './types.js';

export interface GoldenDocument {
  id: string;
  source: string;
  content: string;
}

export interface GoldenCase {
  id: string;
  query: string;
  documents: readonly GoldenDocument[];
  relevantDocumentIds: readonly string[];
  expectedAnswer?: string;
  notes?: string;
}

export interface GoldenDataset {
  version: string;
  name: string;
  createdAt?: string;
  description?: string;
  source?: string;
  limitations?: readonly string[];
  cases: readonly GoldenCase[];
}

export interface CaseRetrievalMetrics {
  caseId: string;
  recallAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
  retrievedSourceIds: readonly string[];
}

export interface RetrievalAggregateMetrics {
  sampleSize: number;
  recallAtK: number;
  mrr: number;
  ndcgAtK: number;
}

export async function loadGoldenDataset(datasetPath: string): Promise<GoldenDataset> {
  const raw = await readFile(datasetPath, 'utf8');
  return JSON.parse(raw) as GoldenDataset;
}

export function recallAtK(retrievedSourceIds: readonly string[], relevantIds: readonly string[], k: number): number {
  if (relevantIds.length === 0) return 1; // no relevant evidence expected
  const top = new Set(retrievedSourceIds.slice(0, k));
  return relevantIds.some((id) => top.has(id)) ? 1 : 0;
}

export function reciprocalRank(retrievedSourceIds: readonly string[], relevantIds: readonly string[]): number {
  if (relevantIds.length === 0) return 1;
  for (let i = 0; i < retrievedSourceIds.length; i += 1) {
    const id = retrievedSourceIds[i];
    if (id && relevantIds.includes(id)) return 1 / (i + 1);
  }
  return 0;
}

/** Discounted Cumulative Gain at K: sum(rel_i / log2(i+1)) for i=1..K. */
export function dcgAtK(retrievedSourceIds: readonly string[], relevantIds: readonly string[], k: number): number {
  if (relevantIds.length === 0) return 0;
  const top = new Set(retrievedSourceIds.slice(0, k));
  let dcg = 0;
  for (let i = 0; i < retrievedSourceIds.length && i < k; i += 1) {
    const id = retrievedSourceIds[i];
    if (id && top.has(id) && relevantIds.includes(id)) {
      dcg += 1 / Math.log2(i + 2); // i is 0-based; position is i+1; denominator log2(position+1) = log2(i+2)
    }
  }
  return dcg;
}

/** Normalized DCG at K: DCG / IDCG (ideal ordering of relevant items first). */
export function ndcgAtK(retrievedSourceIds: readonly string[], relevantIds: readonly string[], k: number): number {
  if (relevantIds.length === 0) return 1; // no relevant evidence expected
  const dcg = dcgAtK(retrievedSourceIds, relevantIds, k);

  // Ideal DCG: all relevant items ranked first (binary relevance = 1 each).
  const idealCount = Math.min(relevantIds.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i += 1) {
    idcg += 1 / Math.log2(i + 2);
  }
  if (idcg === 0) return 0;
  return dcg / idcg;
}

export function aggregateRetrievalMetrics(cases: readonly CaseRetrievalMetrics[]): RetrievalAggregateMetrics {
  const sampleSize = cases.length;
  if (sampleSize === 0) return { sampleSize: 0, recallAtK: 0, mrr: 0, ndcgAtK: 0 };
  const recallSum = cases.reduce((sum, c) => sum + c.recallAtK, 0);
  const mrrSum = cases.reduce((sum, c) => sum + c.reciprocalRank, 0);
  const ndcgSum = cases.reduce((sum, c) => sum + c.ndcgAtK, 0);
  return {
    sampleSize,
    recallAtK: recallSum / sampleSize,
    mrr: mrrSum / sampleSize,
    ndcgAtK: ndcgSum / sampleSize,
  };
}

export function retrievedSourceIds(results: readonly RetrievalResult[]): string[] {
  // Prefer original document/source mapping if present in metadata; fall back to sourceId.
  return results.map((r) => (r.chunk.metadata.attributes?.['goldenDocumentId'] as string | undefined) ?? r.sourceId);
}
