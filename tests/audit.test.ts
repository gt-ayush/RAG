import { describe, expect, it } from 'vitest';
import { createAuditLog } from '../src/audit.js';
import type { AuditEvent, AuditEventType } from '../src/types.js';

function makeEvent(
  overrides: Partial<Omit<AuditEvent, 'seq' | 'hash'>> = {},
): Omit<AuditEvent, 'seq' | 'hash'> {
  return {
    type: 'query.received' as AuditEventType,
    payload: { text: 'sample query', tenantId: 'tenant-a', userId: 'user-123' },
    ...overrides,
  };
}

describe('AuditLog', () => {
  it('appends events with incrementing seq and hash chain', async () => {
    const log = createAuditLog();
    const e1 = await log.append(makeEvent({ type: 'query.received' }));
    const e2 = await log.append(makeEvent({ type: 'query.retrieved' }));

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e1.previousHash).toBe('');
    expect(e2.previousHash).toBe(e1.hash);
    expect(e1.hash).toBeDefined();
    expect(e2.hash).toBeDefined();
    expect(e1.hash).not.toBe(e2.hash);
  });

  it('verifies integrity of a valid chain', async () => {
    const log = createAuditLog();
    await log.append(makeEvent({ type: 'query.received' }));
    await log.append(makeEvent({ type: 'query.retrieved' }));
    await log.append(makeEvent({ type: 'generation.completed' }));

    expect(await log.verifyIntegrity()).toBe(true);
  });

  it('hash differs when payload changes', async () => {
    const log = createAuditLog();
    const e1 = await log.append(
      makeEvent({ type: 'query.received', payload: { text: 'a' } }),
    );
    const e2 = await log.append(
      makeEvent({ type: 'query.received', payload: { text: 'b' } }),
    );
    expect(e1.hash).not.toBe(e2.hash);
  });

  it('redacts sensitive keys in payload', async () => {
    const log = createAuditLog();
    const event = await log.append(
      makeEvent({
        type: 'query.received',
        payload: {
          text: 'sensitive query text',
          apiKey: 'sk-1234567890',
          userId: 'user-123',
          tenantId: 'tenant-a',
          normalField: 'visible',
        },
      }),
    );

    expect(event.payload.apiKey).toBe('[REDACTED]');
    expect(event.payload.text).toBe('sensitive query text');
    expect(event.payload.userId).toMatch(/^sha256:/);
    expect(event.payload.tenantId).toMatch(/^sha256:/);
    expect(event.payload.normalField).toBe('visible');
  });

  it('enforces maxEvents retention', async () => {
    const log = createAuditLog({ maxEvents: 3 });
    await log.append(makeEvent({ type: 'query.received' }));
    await log.append(makeEvent({ type: 'query.received' }));
    await log.append(makeEvent({ type: 'query.received' }));
    await log.append(makeEvent({ type: 'query.received' }));

    expect(log.count()).toBe(3);
    const events = await log.read();
    expect(events.map((e) => e.seq)).toEqual([2, 3, 4]);
  });

  it('read supports seq range and limit', async () => {
    const log = createAuditLog();
    await log.append(makeEvent({ type: 'query.received' }));
    await log.append(makeEvent({ type: 'query.retrieved' }));
    await log.append(makeEvent({ type: 'generation.completed' }));

    const all = await log.read();
    expect(all).toHaveLength(3);

    const limited = await log.read({ limit: 2 });
    expect(limited).toHaveLength(2);

    const fromSeq2 = await log.read({ fromSeq: 2 });
    expect(fromSeq2.map((e) => e.seq)).toEqual([2, 3]);
  });
});

describe('AuditEventType', () => {
  it('covers query, retrieval, generation, ingestion, deletion, erasure events', () => {
    const types: AuditEventType[] = [
      'query.received',
      'query.retrieved',
      'query.retrieval_error',
      'query.authorization_denied',
      'generation.started',
      'generation.completed',
      'generation.error',
      'generation.insufficient_context',
      'ingestion.started',
      'ingestion.completed',
      'ingestion.error',
      'deletion.requested',
      'deletion.completed',
      'erasure.requested',
      'erasure.completed',
    ];
    expect(types.length).toBe(15);
  });
});
