import type {
  CostConfig,
  CostMetrics,
  EmbeddingCost,
  ErasureResult,
  ErasureService,
  GenerationCost,
  IngestionCost,
  QueryCost,
  RetrievalResult,
} from './types.js';

/**
 * Source-of-truth keywords: cost tracking, cost per query, cost per ingestion,
 * token counting, pricing model, capacity planning
 */

/**
 * Tracks embedding costs per call.
 */
export class EmbeddingCostTracker {
  private readonly config: CostConfig;
  private totalCost = 0;
  private totalTokenCount = 0;
  private callCount = 0;

  constructor(config: CostConfig) {
    this.config = config;
  }

  track(texts: string[], model: string): EmbeddingCost {
    let tokenCount = 0;
    for (const text of texts) {
      tokenCount += this.countTokens(text);
    }
    const cost = (tokenCount / 1000) * this.config.embeddingCostPer1kTokens;
    this.totalCost += cost;
    this.totalTokenCount += tokenCount;
    this.callCount += 1;
    return { tokenCount, cost, model };
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getTotalTokenCount(): number {
    return this.totalTokenCount;
  }

  getCallCount(): number {
    return this.callCount;
  }

  private countTokens(text: string): number {
    // Simple approximation: ~4 characters per token for English text
    return Math.ceil(text.length / 4);
  }
}

/**
 * Tracks generation (LLM) costs per call.
 */
export class GenerationCostTracker {
  private readonly config: CostConfig;
  private totalCost = 0;
  private totalInputTokens = 0;
  private totalOutputTokens = 0;
  private callCount = 0;

  constructor(config: CostConfig) {
    this.config = config;
  }

  track(inputText: string, outputText: string, model: string): GenerationCost {
    const inputTokens = this.countTokens(inputText);
    const outputTokens = this.countTokens(outputText);
    const inputCost = (inputTokens / 1000) * this.config.llmInputCostPer1kTokens;
    const outputCost = (outputTokens / 1000) * this.config.llmOutputCostPer1kTokens;
    const cost = inputCost + outputCost;
    this.totalCost += cost;
    this.totalInputTokens += inputTokens;
    this.totalOutputTokens += outputTokens;
    this.callCount += 1;
    return { inputTokens, outputTokens, cost, model };
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getTotalGenerationCost(): number {
    return this.totalCost;
  }

  getTotalInputTokens(): number {
    return this.totalInputTokens;
  }

  getTotalOutputTokens(): number {
    return this.totalOutputTokens;
  }

  getCallCount(): number {
    return this.callCount;
  }

  private countTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

/**
 * Tracks ingestion (embedding + indexing) costs per batch.
 */
export class IngestionCostTracker {
  private readonly config: CostConfig;
  private totalCost = 0;
  private totalEmbeddingCost = 0;
  private totalIndexingCost = 0;
  private totalChunkCount = 0;
  private callCount = 0;

  constructor(config: CostConfig) {
    this.config = config;
  }

  track(chunkCount: number, embeddingCost: number, indexingCost: number): IngestionCost {
    const totalCost = embeddingCost + indexingCost;
    this.totalCost += totalCost;
    this.totalEmbeddingCost += embeddingCost;
    this.totalIndexingCost += indexingCost;
    this.totalChunkCount += chunkCount;
    this.callCount += 1;
    return { chunkCount, embeddingCost, indexingCost, totalCost };
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getTotalEmbeddingCost(): number {
    return this.totalEmbeddingCost;
  }

  getTotalIndexingCost(): number {
    return this.totalIndexingCost;
  }

  getTotalChunkCount(): number {
    return this.totalChunkCount;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Tracks query (embedding + retrieval + generation) costs per call.
 */
export class QueryCostTracker {
  private readonly config: CostConfig;
  private totalCost = 0;
  private totalEmbeddingCost = 0;
  private totalRetrievalCost = 0;
  private totalGenerationCost = 0;
  private callCount = 0;

  constructor(config: CostConfig) {
    this.config = config;
  }

  track(
    embeddingCost: number,
    retrievalCost: number,
    generationCost: number,
  ): QueryCost {
    const totalCost = embeddingCost + retrievalCost + generationCost;
    this.totalCost += totalCost;
    this.totalEmbeddingCost += embeddingCost;
    this.totalRetrievalCost += retrievalCost;
    this.totalGenerationCost += generationCost;
    this.callCount += 1;
    return { embeddingCost, retrievalCost, generationCost, totalCost };
  }

  getTotalCost(): number {
    return this.totalCost;
  }

  getTotalEmbeddingCost(): number {
    return this.totalEmbeddingCost;
  }

  getTotalRetrievalCost(): number {
    return this.totalRetrievalCost;
  }

  getTotalGenerationCost(): number {
    return this.totalGenerationCost;
  }

  getCallCount(): number {
    return this.callCount;
  }
}

/**
 * Aggregates cost metrics across all trackers.
 */
export class CostMetricsTracker {
  private embeddingTracker: EmbeddingCostTracker;
  private generationTracker: GenerationCostTracker;
  private ingestionTracker: IngestionCostTracker;
  private queryTracker: QueryCostTracker;

  constructor(config: CostConfig) {
    this.embeddingTracker = new EmbeddingCostTracker(config);
    this.generationTracker = new GenerationCostTracker(config);
    this.ingestionTracker = new IngestionCostTracker(config);
    this.queryTracker = new QueryCostTracker(config);
  }

  getEmbeddingTracker(): EmbeddingCostTracker {
    return this.embeddingTracker;
  }

  getGenerationTracker(): GenerationCostTracker {
    return this.generationTracker;
  }

  getIngestionTracker(): IngestionCostTracker {
    return this.ingestionTracker;
  }

  getQueryTracker(): QueryCostTracker {
    return this.queryTracker;
  }

  snapshot(): CostMetrics {
    const totalCost =
      this.embeddingTracker.getTotalCost() +
      this.generationTracker.getTotalCost() +
      this.ingestionTracker.getTotalCost() +
      this.queryTracker.getTotalCost();
    const totalTokenCount =
      this.embeddingTracker.getTotalTokenCount() +
      this.generationTracker.getTotalInputTokens() +
      this.generationTracker.getTotalOutputTokens();
    const totalQueries = this.queryTracker.getCallCount();
    const totalIngestions = this.ingestionTracker.getCallCount();
    return {
      totalCost,
      totalEmbeddingCost:
        this.embeddingTracker.getTotalCost() +
        this.ingestionTracker.getTotalEmbeddingCost() +
        this.queryTracker.getTotalEmbeddingCost(),
      totalGenerationCost:
        this.generationTracker.getTotalGenerationCost() +
        this.queryTracker.getTotalGenerationCost(),
      totalIndexingCost: this.ingestionTracker.getTotalIndexingCost(),
      totalRetrievalCost: this.queryTracker.getTotalRetrievalCost(),
      costPerQuery: totalQueries > 0 ? totalCost / totalQueries : 0,
      costPerIngestion: totalIngestions > 0 ? totalCost / totalIngestions : 0,
      queryCount: totalQueries,
      ingestionCount: totalIngestions,
      totalTokenCount,
    };
  }
}

/**
 * Estimates capacity (max queries per unit time) based on observed cost per query
 * and a given budget.
 */
export interface CapacityEstimate {
  /** Max queries per hour at current cost per query. */
  maxQueriesPerHour: number;
  /** Max queries per day at current cost per query. */
  maxQueriesPerDay: number;
  /** Max queries per month (30 days) at current cost per query. */
  maxQueriesPerMonth: number;
  /** Estimated monthly cost at max queries per month. */
  estimatedMonthlyCost: number;
  /** Budget in USD per month. */
  monthlyBudgetUsd: number;
  /** Cost per query used for estimation. */
  costPerQuery: number;
}

/**
 * Estimates capacity based on cost per query and a monthly budget.
 */
export function estimateCapacity(
  costPerQuery: number,
  monthlyBudgetUsd: number,
): CapacityEstimate {
  const maxQueriesPerMonth = monthlyBudgetUsd / costPerQuery;
  const maxQueriesPerDay = maxQueriesPerMonth / 30;
  const maxQueriesPerHour = maxQueriesPerDay / 24;
  const estimatedMonthlyCost = maxQueriesPerMonth * costPerQuery;
  return {
    maxQueriesPerHour,
    maxQueriesPerDay,
    maxQueriesPerMonth,
    estimatedMonthlyCost,
    monthlyBudgetUsd,
    costPerQuery,
  };
}

/** Default cost configuration using typical OpenAI-style pricing (per 1K tokens). */
export const DefaultCostConfig: CostConfig = {
  embeddingCostPer1kTokens: 0.10,
  llmInputCostPer1kTokens: 0.50,
  llmOutputCostPer1kTokens: 1.50,
  vectorWriteCostPer1kVectors: 0.10,
  vectorReadCostPer1kVectors: 0.05,
};

/**
 * Creates a CostMetricsTracker with the given config (or default config if none provided).
 */
export function createCostTracker(config?: CostConfig): CostMetricsTracker {
  return new CostMetricsTracker(config ?? DefaultCostConfig);
}
