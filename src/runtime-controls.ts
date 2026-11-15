import type {
  CircuitBreakerConfig,
  CircuitBreakerMetrics,
  CircuitBreakerState,
  ConcurrencyLimiterConfig,
  ConcurrencyLimiterMetrics,
  CacheMetrics,
  RuntimeControlsConfig,
  RuntimeControlsMetrics,
} from './types.js';

/**
 * Source-of-truth keywords: concurrency, circuit breaker, cache, rate limit,
 * backpressure, runtime controls
 */

/**
 * Concurrency limiter that bounds in-flight operations.
 * Rejects when the queue is full or the acquire timeout expires.
 */
export class ConcurrencyLimiter {
  private readonly maxConcurrent: number;
  private readonly maxQueueSize: number;
  private readonly acquireTimeoutMs: number;
  private active = 0;
  private queued = 0;
  private completed = 0;
  private rejected = 0;
  private timeouts = 0;

  constructor(config: ConcurrencyLimiterConfig) {
    this.maxConcurrent = config.maxConcurrent;
    this.maxQueueSize = config.maxQueueSize;
    this.acquireTimeoutMs = config.acquireTimeoutMs;
  }

  async acquire<T>(op: () => Promise<T>): Promise<T> {
    // Try to acquire immediately - no await between check and increment
    // to prevent race conditions in the single-threaded event loop.
    if (this.active < this.maxConcurrent) {
      this.active += 1;
    } else if (this.queued < this.maxQueueSize) {
      this.queued += 1;
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            this.queued -= 1;
            this.timeouts += 1;
            reject(new Error('concurrency acquire timeout'));
          }, this.acquireTimeoutMs);
          this.waitQueue.push({ resolve, reject, timer });
        });
      } finally {
        this.queued -= 1;
      }
      this.active += 1;
    } else {
      this.rejected += 1;
      throw new Error('concurrency queue full');
    }

    try {
      return await op();
    } finally {
      this.active -= 1;
      this.completed += 1;
      this.notifyWaiter();
    }
  }

  private waitQueue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private notifyWaiter(): void {
    while (this.waitQueue.length > 0 && this.active < this.maxConcurrent) {
      const waiter = this.waitQueue.shift()!;
      clearTimeout(waiter.timer);
      this.queued -= 1;
      this.active += 1;
      waiter.resolve();
    }
  }

  snapshot(): ConcurrencyLimiterMetrics {
    return {
      active: this.active,
      queued: this.queued,
      completed: this.completed,
      rejected: this.rejected,
      timeouts: this.timeouts,
    };
  }
}

/**
 * Circuit breaker that tracks failures and opens after a threshold.
 * In open state, calls fail fast without executing. After recoveryTimeoutMs,
 * transitions to half-open and allows a limited number of trial calls.
 */
export class CircuitBreaker {
  private readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private trips = 0;
  private lastFailureTime: string | undefined;
  private halfOpenAttempts = 0;
  private lastStateChangeTime = Date.now();

  constructor(config: CircuitBreakerConfig) {
    this.config = config;
  }

  async execute<T>(op: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastStateChangeTime >= this.config.recoveryTimeoutMs) {
        this.transitionToHalfOpen();
      } else {
        this.trips += 1;
        throw new Error('circuit breaker open');
      }
    }

    try {
      const result = await op();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenAttempts += 1;
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.transitionToClosed();
      }
    } else {
      this.successes += 1;
      this.failures = 0;
    }
  }

  private onFailure(): void {
    this.failures += 1;
    this.lastFailureTime = new Date().toISOString();
    if (this.state === 'half-open') {
      this.transitionToOpen();
    } else if (this.failures >= this.config.failureThreshold) {
      this.transitionToOpen();
    }
  }

  private transitionToOpen(): void {
    this.state = 'open';
    this.lastStateChangeTime = Date.now();
    this.trips += 1;
    this.halfOpenAttempts = 0;
  }

  private transitionToHalfOpen(): void {
    this.state = 'half-open';
    this.lastStateChangeTime = Date.now();
    this.halfOpenAttempts = 0;
  }

  private transitionToClosed(): void {
    this.state = 'closed';
    this.lastStateChangeTime = Date.now();
    this.failures = 0;
    this.halfOpenAttempts = 0;
  }

  snapshot(): CircuitBreakerMetrics {
    const result: CircuitBreakerMetrics = {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      totalCalls: this.successes + this.failures,
      trips: this.trips,
    };
    if (this.lastFailureTime) {
      result.lastFailureTime = this.lastFailureTime;
    }
    return result;
  }
}

/**
 * Simple TTL cache with max size (LRU eviction).
 */
export class SimpleCache<K, V> {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly map = new Map<K, { value: V; expiry: number }>();
  private hits = 0;
  private misses = 0;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses += 1;
      return undefined;
    }
    if (Date.now() > entry.expiry) {
      this.map.delete(key);
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    // Move to end (most recently used)
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
    this.map.set(key, { value, expiry: Date.now() + this.ttlMs });
  }

  snapshot(): CacheMetrics {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.map.size,
      maxSize: this.maxSize,
    };
  }
}

/**
 * Combined runtime controls: concurrency limiter, circuit breaker, and cache.
 * Provides fail-closed behavior under load and metrics for observability.
 */
export class RuntimeControls {
  private readonly limiter: ConcurrencyLimiter;
  private readonly breaker: CircuitBreaker;
  private readonly cache: SimpleCache<string, unknown>;

  constructor(config: RuntimeControlsConfig) {
    this.limiter = new ConcurrencyLimiter(config.concurrency);
    this.breaker = new CircuitBreaker(config.circuitBreaker);
    this.cache = new SimpleCache(config.cache.maxSize, config.cache.ttlMs);
  }

  async execute<T>(key: string, op: () => Promise<T>): Promise<T> {
    const cacheKey = key;
    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      return cached as T;
    }

    return this.limiter.acquire(async () => {
      return this.breaker.execute(async () => {
        const result = await op();
        this.cache.set(cacheKey, result);
        return result;
      });
    });
  }

  snapshot(): RuntimeControlsMetrics {
    return {
      concurrency: this.limiter.snapshot(),
      circuitBreaker: this.breaker.snapshot(),
      cache: this.cache.snapshot(),
    };
  }
}
