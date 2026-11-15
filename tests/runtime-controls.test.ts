import { describe, expect, it, vi } from 'vitest';
import { ConcurrencyLimiter, CircuitBreaker, SimpleCache, RuntimeControls } from '../src/runtime-controls.js';

describe('ConcurrencyLimiter', () => {
  it('allows concurrent operations up to maxConcurrent', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueueSize: 10, acquireTimeoutMs: 1000 });
    const results: number[] = [];

    async function op(delay: number) {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return delay;
    }

    const promises = [
      limiter.acquire(() => op(50)),
      limiter.acquire(() => op(100)),
      limiter.acquire(() => op(150)),
    ];
    const values = await Promise.all(promises);
    expect(values).toEqual([50, 100, 150]);
  });

  it('rejects when queue is full', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, maxQueueSize: 1, acquireTimeoutMs: 10000 });

    // Acquire one slot and hold it
    const blocked = limiter.acquire(() => new Promise((resolve) => setTimeout(resolve, 50)));

    // This should queue (queue size is 1)
    const queued = limiter.acquire(() => Promise.resolve(1));

    // This should reject (queue is full)
    await expect(limiter.acquire(() => Promise.resolve(2))).rejects.toThrow('concurrency queue full');

    // Let the queued one proceed
    await blocked;
    await queued;
  });

  it('times out when queue wait exceeds acquireTimeoutMs', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 1, maxQueueSize: 5, acquireTimeoutMs: 50 });
    const blocked = limiter.acquire(() => new Promise((resolve) => setTimeout(resolve, 200)));

    await expect(limiter.acquire(() => Promise.resolve(1))).rejects.toThrow('concurrency acquire timeout');
    await blocked;
  });

  it('snapshot reports correct metrics', async () => {
    const limiter = new ConcurrencyLimiter({ maxConcurrent: 2, maxQueueSize: 5, acquireTimeoutMs: 1000 });

    const promise = limiter.acquire(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const snapshot = limiter.snapshot();
    expect(snapshot.active).toBe(1);
    expect(snapshot.completed).toBe(0);

    await promise;
    const snapshot2 = limiter.snapshot();
    expect(snapshot2.active).toBe(0);
    expect(snapshot2.completed).toBe(1);
  });
});

describe('CircuitBreaker', () => {
  it('allows calls when closed', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 3, recoveryTimeoutMs: 1000, halfOpenMaxAttempts: 1 });
    const result = await breaker.execute(() => Promise.resolve('success'));
    expect(result).toBe('success');
  });

  it('opens circuit after failure threshold', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 1000, halfOpenMaxAttempts: 1 });

    await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(breaker.execute(() => Promise.resolve('should not reach'))).rejects.toThrow('circuit breaker open');
  });

  it('transitions to half-open after recovery timeout', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 1, recoveryTimeoutMs: 50, halfOpenMaxAttempts: 1 });

    await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('circuit breaker open');

    await new Promise((resolve) => setTimeout(resolve, 60));

    // Half-open: first call succeeds, circuit closes
    const result = await breaker.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');

    // Circuit should be closed now
    const result2 = await breaker.execute(() => Promise.resolve('closed'));
    expect(result2).toBe('closed');
  });

  it('snapshot reports correct metrics', async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, recoveryTimeoutMs: 1000, halfOpenMaxAttempts: 1 });

    await breaker.execute(() => Promise.resolve('ok'));
    await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow('fail');

    const snap = breaker.snapshot();
    expect(snap.state).toBe('closed');
    expect(snap.failures).toBe(1);
    expect(successes(snap)).toBe(1);
  });
});

function successes(snap: { successes: number }): number {
  return snap.successes;
}

describe('SimpleCache', () => {
  it('stores and retrieves values', async () => {
    const cache = new SimpleCache<string, string>(3, 1000);
    cache.set('a', '1');
    cache.set('b', '2');

    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBeUndefined();
  });

  it('expires entries after ttlMs', async () => {
    const cache = new SimpleCache<string, string>(3, 50);
    cache.set('a', '1');

    expect(cache.get('a')).toBe('1');
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(cache.get('a')).toBeUndefined();
  });

  it('evicts oldest entries when maxSize exceeded', async () => {
    const cache = new SimpleCache<string, string>(2, 10000);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('snapshot reports correct metrics', async () => {
    const cache = new SimpleCache<string, string>(3, 10000);
    cache.set('a', '1');
    cache.get('a');
    cache.get('b');

    const snap = cache.snapshot();
    expect(snap.hits).toBe(1);
    expect(snap.misses).toBe(1);
    expect(snap.size).toBe(1);
    expect(snap.maxSize).toBe(3);
  });
});

describe('RuntimeControls', () => {
  it('executes through limiter, breaker, and cache', async () => {
    const controls = new RuntimeControls({
      concurrency: { maxConcurrent: 2, maxQueueSize: 10, acquireTimeoutMs: 1000 },
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 1000, halfOpenMaxAttempts: 1 },
      cache: { maxSize: 10, ttlMs: 10000 },
    });

    const result1 = await controls.execute('key1', () => Promise.resolve(42));
    const result2 = await controls.execute('key1', () => Promise.resolve(99)); // should return cached

    expect(result1).toBe(42);
    expect(result2).toBe(42); // cached
  });

  it('snapshot returns combined metrics', async () => {
    const controls = new RuntimeControls({
      concurrency: { maxConcurrent: 2, maxQueueSize: 10, acquireTimeoutMs: 1000 },
      circuitBreaker: { failureThreshold: 3, recoveryTimeoutMs: 1000, halfOpenMaxAttempts: 1 },
      cache: { maxSize: 10, ttlMs: 10000 },
    });

    await controls.execute('key1', () => Promise.resolve(42));

    const snap = controls.snapshot();
    expect(snap.concurrency.completed).toBe(1);
    expect(snap.circuitBreaker.totalCalls).toBe(1);
    expect(snap.cache.hits).toBe(0);
    expect(snap.cache.misses).toBe(1);
  });
});
