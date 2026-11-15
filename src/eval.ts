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
  retrievedSourceIds: readonly string[];
}

export interface RetrievalAggregateMetrics {
  sampleSize: number;
  recallAtK: number;
  mrr: number;
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

export function aggregateRetrievalMetrics(cases: readonly CaseRetrievalMetrics[]): RetrievalAggregateMetrics {
  const sampleSize = cases.length;
  if (sampleSize === 0) return { sampleSize: 0, recallAtK: 0, mrr: 0 };
  const recallSum = cases.reduce((sum, c) => sum + c.recallAtK, 0);
  const mrrSum = cases.reduce((sum, c) => sum + c.reciprocalRank, 0);
  return {
    sampleSize,
    recallAtK: recallSum / sampleSize,
    mrr: mrrSum / sampleSize,
  };
}

export function retrievedSourceIds(results: readonly RetrievalResult[]): string[] {
  // Prefer original document/source mapping if present in metadata; fall back to sourceId.
  return results.map((r) => (r.chunk.metadata.attributes?.['goldenDocumentId'] as string | undefined) ?? r.sourceId);
}
