import { describe, expect, it } from 'vitest';
import {
  CostMetricsTracker,
  createCostTracker,
  DefaultCostConfig,
  EmbeddingCostTracker,
  GenerationCostTracker,
  IngestionCostTracker,
  QueryCostTracker,
} from '../src/cost-tracking.js';
import type { CostConfig } from '../src/types.js';

describe('EmbeddingCostTracker', () => {
  const config: CostConfig = {
    embeddingCostPer1kTokens: 0.10,
    llmInputCostPer1kTokens: 0.50,
    llmOutputCostPer1kTokens: 1.50,
    vectorWriteCostPer1kVectors: 0.10,
    vectorReadCostPer1kVectors: 0.05,
  };

  it('tracks embedding cost correctly', () => {
    const tracker = new EmbeddingCostTracker(config);
    const result = tracker.track(['hello world', 'test'], 'test-embed');

    expect(result.tokenCount).toBeGreaterThan(0);
    expect(result.cost).toBe(result.tokenCount / 1000 * 0.10);
    expect(result.model).toBe('test-embed');
    expect(tracker.getTotalCost()).toBe(result.cost);
    expect(tracker.getCallCount()).toBe(1);
    expect(tracker.getTotalTokenCount()).toBe(result.tokenCount);
  });

  it('accumulates costs across multiple calls', () => {
    const tracker = new EmbeddingCostTracker(config);
    tracker.track(['hello'], 'test-embed');
    tracker.track(['world'], 'test-embed');
    expect(tracker.getCallCount()).toBe(2);
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });
});

describe('GenerationCostTracker', () => {
  const config: CostConfig = {
    embeddingCostPer1kTokens: 0.10,
    llmInputCostPer1kTokens: 0.50,
    llmOutputCostPer1kTokens: 1.50,
    vectorWriteCostPer1kVectors: 0.10,
    vectorReadCostPer1kVectors: 0.05,
  };

  it('tracks generation cost correctly', () => {
    const tracker = new GenerationCostTracker(config);
    const result = tracker.track('input text here', 'output text here', 'test-model');

    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.cost).toBe(
      (result.inputTokens / 1000) * 0.50 +
      (result.outputTokens / 1000) * 1.50
    );
    expect(result.model).toBe('test-model');
    expect(tracker.getTotalCost()).toBe(result.cost);
    expect(tracker.getTotalInputTokens()).toBe(result.inputTokens);
    expect(tracker.getTotalOutputTokens()).toBe(result.outputTokens);
    expect(tracker.getTotalGenerationCost()).toBe(result.cost);
  });

  it('accumulates costs across multiple calls', () => {
    const tracker = new GenerationCostTracker(config);
    tracker.track('a', 'b', 'model-1');
    tracker.track('c', 'd', 'model-1');
    expect(tracker.getCallCount()).toBe(2);
    expect(tracker.getTotalCost()).toBeGreaterThan(0);
  });
});

describe('IngestionCostTracker', () => {
  const config: CostConfig = {
    embeddingCostPer1kTokens: 0.10,
    llmInputCostPer1kTokens: 0.50,
    llmOutputCostPer1kTokens: 1.50,
    vectorWriteCostPer1kVectors: 0.10,
    vectorReadCostPer1kVectors: 0.05,
  };

  it('tracks ingestion cost correctly', () => {
    const tracker = new IngestionCostTracker(config);
    const result = tracker.track(10, 0.05, 0.02);

    expect(result.chunkCount).toBe(10);
    expect(result.embeddingCost).toBe(0.05);
    expect(result.indexingCost).toBe(0.02);
    expect(result.totalCost).toBe(0.07);
    expect(tracker.getTotalCost()).toBe(0.07);
    expect(tracker.getTotalEmbeddingCost()).toBe(0.05);
    expect(tracker.getTotalIndexingCost()).toBe(0.02);
    expect(tracker.getTotalChunkCount()).toBe(10);
  });

  it('accumulates costs across multiple calls', () => {
    const tracker = new IngestionCostTracker(config);
    tracker.track(5, 0.01, 0.01);
    tracker.track(5, 0.01, 0.01);
    expect(tracker.getCallCount()).toBe(2);
    expect(tracker.getTotalCost()).toBe(0.04);
    expect(tracker.getTotalChunkCount()).toBe(10);
  });
});

describe('QueryCostTracker', () => {
  const config: CostConfig = {
    embeddingCostPer1kTokens: 0.10,
    llmInputCostPer1kTokens: 0.50,
    llmOutputCostPer1kTokens: 1.50,
    vectorWriteCostPer1kVectors: 0.10,
    vectorReadCostPer1kVectors: 0.05,
  };

  it('tracks query cost correctly', () => {
    const tracker = new QueryCostTracker(config);
    const result = tracker.track(0.01, 0.02, 0.03);

    expect(result.embeddingCost).toBe(0.01);
    expect(result.retrievalCost).toBe(0.02);
    expect(result.generationCost).toBe(0.03);
    expect(result.totalCost).toBe(0.06);
    expect(tracker.getTotalCost()).toBe(0.06);
    expect(tracker.getTotalEmbeddingCost()).toBe(0.01);
    expect(tracker.getTotalRetrievalCost()).toBe(0.02);
    expect(tracker.getTotalGenerationCost()).toBe(0.03);
  });

  it('accumulates costs across multiple calls', () => {
    const tracker = new QueryCostTracker(config);
    tracker.track(0.01, 0.01, 0.01);
    tracker.track(0.01, 0.01, 0.01);
    expect(tracker.getCallCount()).toBe(2);
    expect(tracker.getTotalCost()).toBe(0.06);
  });
});

describe('CostMetricsTracker', () => {
  const config: CostConfig = {
    embeddingCostPer1kTokens: 0.10,
    llmInputCostPer1kTokens: 0.50,
    llmOutputCostPer1kTokens: 1.50,
    vectorWriteCostPer1kVectors: 0.10,
    vectorReadCostPer1kVectors: 0.05,
  };

  it('aggregates costs from all trackers', () => {
    const tracker = new CostMetricsTracker(config);

    tracker.getEmbeddingTracker().track(['hello world'], 'test-embed');
    tracker.getGenerationTracker().track('input text', 'output text', 'test-model');
    tracker.getIngestionTracker().track(10, 0.05, 0.02);
    tracker.getQueryTracker().track(0.01, 0.02, 0.03);

    const metrics = tracker.snapshot();
    expect(metrics.totalCost).toBeGreaterThan(0);
    expect(metrics.totalEmbeddingCost).toBeGreaterThan(0);
    expect(metrics.totalGenerationCost).toBeGreaterThan(0);
    expect(metrics.totalIndexingCost).toBeGreaterThan(0);
    expect(metrics.totalRetrievalCost).toBeGreaterThan(0);
    expect(metrics.queryCount).toBe(1);
    expect(metrics.ingestionCount).toBe(1);
    expect(metrics.totalTokenCount).toBeGreaterThan(0);
    expect(metrics.costPerQuery).toBeGreaterThan(0);
    expect(metrics.costPerIngestion).toBeGreaterThan(0);
  });

  it('returns zeros for empty tracker', () => {
    const tracker = new CostMetricsTracker(config);
    const metrics = tracker.snapshot();
    expect(metrics.totalCost).toBe(0);
    expect(metrics.queryCount).toBe(0);
    expect(metrics.ingestionCount).toBe(0);
    expect(metrics.costPerQuery).toBe(0);
    expect(metrics.costPerIngestion).toBe(0);
  });
});

describe('createCostTracker', () => {
  it('creates a tracker with default config', () => {
    const tracker = createCostTracker();
    expect(tracker).toBeInstanceOf(CostMetricsTracker);
    const metrics = tracker.snapshot();
    expect(metrics.totalCost).toBe(0);
  });

  it('creates a tracker with custom config', () => {
    const config: CostConfig = {
      embeddingCostPer1kTokens: 0.20,
      llmInputCostPer1kTokens: 1.00,
      llmOutputCostPer1kTokens: 3.00,
      vectorWriteCostPer1kVectors: 0.20,
      vectorReadCostPer1kVectors: 0.10,
    };
    const tracker = createCostTracker(config);
    expect(tracker).toBeInstanceOf(CostMetricsTracker);
  });
});
