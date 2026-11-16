#!/usr/bin/env node
/**
 * src/cli.ts — Production entry point for the RAG HTTP service (Phase 15.1).
 *
 * Loads and validates configuration from environment variables, wires the
 * pipeline dependencies behind the existing interfaces, creates the HTTP
 * service, registers graceful-shutdown signal handling, and listens on the
 * configured PORT/HOST.
 *
 * No secrets are logged. Required config (LLM_API_KEY, LLM_MODEL,
 * VECTOR_DB_URL, EMBEDDING_MODEL) must be present or the process exits with a
 * non-zero code and a non-secret error message.
 *
 * Source-of-truth keywords: CLI entry point, config loading, HTTP server,
 * graceful shutdown, environment variables
 */

import { createHttpServer, setupGracefulShutdown } from './server.js';
import {
  loadPipelineConfigFromProcessEnv,
} from './config.js';
import {
  ConfigValidationError,
  type PipelineConfig,
  type ValidationIssue,
} from './types.js';
import { HttpEmbeddingProvider } from './embedding-provider.js';
import { QdrantStore } from './qdrant-store.js';
import { HttpLLMProvider } from './llm-provider.js';
import { createStructuredLogger, MetricsRecorder } from './observability.js';

const logger = createStructuredLogger();
const metrics = new MetricsRecorder();

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function requiredEnvAsNumber(name: string): number {
  const value = requiredEnv(name);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid environment variable ${name}: must be a positive number`);
  }
  return parsed;
}

interface WiredDependencies {
  embeddingProvider: InstanceType<typeof HttpEmbeddingProvider>;
  vectorStore: InstanceType<typeof QdrantStore>;
  languageModel: InstanceType<typeof HttpLLMProvider>;
}

function buildDependencies(config: PipelineConfig): WiredDependencies {
  const embeddingProvider = new HttpEmbeddingProvider({
    baseUrl: requiredEnv('EMBEDDING_BASE_URL'),
    model: config.embedding.model,
    dimensions: requiredEnvAsNumber('EMBEDDING_DIMENSIONS'),
    ...(process.env.EMBEDDING_API_KEY ? { apiKey: process.env.EMBEDDING_API_KEY } : {}),
    ...(process.env.EMBEDDING_TIMEOUT_MS
      ? { timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS) }
      : {}),
  });

  const vectorStore = new QdrantStore({
    url: config.vectorDb.url,
    ...(config.vectorDb.apiKey ? { apiKey: config.vectorDb.apiKey } : {}),
    collection: requiredEnv('QDRANT_COLLECTION'),
    dimensions: embeddingProvider.dimensions,
    ...(process.env.VECTOR_DB_TIMEOUT_MS
      ? { timeoutMs: Number(process.env.VECTOR_DB_TIMEOUT_MS) }
      : {}),
  });

  const languageModel = new HttpLLMProvider({
    baseUrl: requiredEnv('LLM_BASE_URL'),
    model: config.llm.model,
    ...(process.env.LLM_API_KEY ? { apiKey: process.env.LLM_API_KEY } : {}),
    ...(config.llm.timeoutMs ? { timeoutMs: config.llm.timeoutMs } : {}),
  });

  return { embeddingProvider, vectorStore, languageModel };
}

async function main(): Promise<void> {
  let config: PipelineConfig;
  try {
    config = loadPipelineConfigFromProcessEnv();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      logger.error('config_validation_failed', {
        issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    } else {
      logger.error('config_load_failed', { error: String(error) });
    }
    process.exit(1);
    return;
  }

  let embeddingProvider: WiredDependencies['embeddingProvider'];
  let vectorStore: WiredDependencies['vectorStore'];
  let languageModel: WiredDependencies['languageModel'];
  try {
    ({ embeddingProvider, vectorStore, languageModel } = buildDependencies(config));
  } catch (error) {
    logger.error('dependency_wiring_failed', { error: String(error) });
    process.exit(1);
    return;
  }

  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? '0.0.0.0';

  const server = createHttpServer({
    config,
    embeddingProvider,
    vectorStore,
    languageModel,
    logger,
    metrics,
  });

  // Graceful shutdown: SIGTERM/SIGINT stop accepting new connections, drain
  // in-flight requests, then close the server.
  const { stop } = setupGracefulShutdown(server, {
    timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 5000),
    onStop: () => logger.info('service_stopped'),
  });

  server.listen(port, host, () => {
    logger.info('service_started', { port, host, env: process.env.NODE_ENV ?? 'development' });
  });

  // Expose stop for process managers / tests.
  (globalThis as { __ragStop?: () => Promise<void> }).__ragStop = stop;
}

main().catch((error) => {
  logger.error('service_fatal', { error: String(error) });
  process.exit(1);
});
