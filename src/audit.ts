import { createHash } from 'node:crypto';
import type {
  AuditEvent,
  AuditEventType,
  AuditLog,
  AuditLogConfig,
  AuditRedactionLevel,
  DocumentId,
} from './types.js';

/**
 * Source-of-truth keywords: audit trail, append-only, hash chain, integrity,
 * redaction, retention
 */

/** Fields whose values are redacted (not hashed) in audit payloads. */
const REDACTED_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie|prompt|evidence|content|document|chunk|query text|raw text)/i;

/** Fields whose values are hashed (one-way) in audit payloads. */
const HASHED_KEY_PATTERN = /(user[-_]?id|tenant[-_]?id|document[-_]?id|ip[-_]?address|email)/i;

const DEFAULT_MAX_EVENTS = 100_000;
const DEFAULT_RETENTION_DAYS = 90;

/**
 * Redacts sensitive values from an audit payload. Sensitive keys are replaced
 * with '[REDACTED]'; user/tenant/document identifiers are SHA-256 hashed;
 * everything else is passed through unchanged.
 */
function redactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (REDACTED_KEY_PATTERN.test(key)) {
      out[key] = '[REDACTED]';
      continue;
    }
    if (HASHED_KEY_PATTERN.test(key) && typeof value === 'string') {
      out[key] = `sha256:${createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 16)}`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * Computes the SHA-256 hash chain value for an event: sha256(seq + timestamp +
 * type + JSON(payload) + previousHash).
 */
function computeHash(
  seq: number,
  timestamp: string,
  type: AuditEventType,
  payload: Record<string, unknown>,
  previousHash: string,
): string {
  const payloadJson = JSON.stringify(payload);
  return createHash('sha256')
    .update(`${seq}|${timestamp}|${type}|${payloadJson}|${previousHash}`, 'utf8')
    .digest('hex');
}

interface AuditLogOptions {
  maxEvents: number;
  retentionDays: number;
  now: () => string;
}

export class AuditLogImpl implements AuditLog {
  private readonly events: AuditEvent[] = [];
  private readonly maxEvents: number;
  private readonly retentionDays: number;
  private readonly now: () => string;
  private seq = 0;
  private previousHash = '';

  constructor(options: AuditLogOptions) {
    this.maxEvents = options.maxEvents;
    this.retentionDays = options.retentionDays;
    this.now = options.now;
  }

  async append(event: Omit<AuditEvent, 'seq' | 'hash' | 'timestamp' | 'previousHash'>): Promise<AuditEvent> {
    this.seq += 1;
    const timestamp = this.now();
    const redactedPayload = redactPayload(event.payload);
    const hash = computeHash(
      this.seq,
      timestamp,
      event.type,
      redactedPayload,
      this.previousHash,
    );

    const written: AuditEvent = {
      seq: this.seq,
      timestamp,
      type: event.type,
      ...(event.tenantId ? { tenantId: event.tenantId } : {}),
      ...(event.documentId ? { documentId: event.documentId } : {}),
      ...(event.correlationId ? { correlationId: event.correlationId } : {}),
      payload: redactedPayload,
      previousHash: this.previousHash,
      hash,
    };

    this.previousHash = hash;
    this.events.push(written);
    this.enforceRetention();
    return written;
  }

  async read(options?: {
    fromSeq?: number;
    toSeq?: number;
    limit?: number;
  }): Promise<readonly AuditEvent[]> {
    let results = [...this.events];
    if (options?.fromSeq !== undefined) {
      results = results.filter((e) => e.seq >= options.fromSeq!);
    }
    if (options?.toSeq !== undefined) {
      results = results.filter((e) => e.seq <= options.toSeq!);
    }
    if (options?.limit !== undefined) {
      results = results.slice(-options.limit);
    }
    return results;
  }

  async verifyIntegrity(): Promise<boolean> {
    let expectedPreviousHash = '';
    for (const event of this.events) {
      if (event.previousHash !== expectedPreviousHash) {
        return false;
      }
      const recomputed = computeHash(
        event.seq,
        event.timestamp,
        event.type,
        event.payload,
        event.previousHash,
      );
      if (recomputed !== event.hash) {
        return false;
      }
      expectedPreviousHash = event.hash;
    }
    return true;
  }

  count(): number {
    return this.events.length;
  }

  private enforceRetention(): void {
    const nowMs = Date.now();
    const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;

    // Drop events older than retention period.
    while (this.events.length > 0) {
      const firstEvent = this.events[0];
      if (!firstEvent) break;
      if (nowMs - new Date(firstEvent.timestamp).getTime() <= retentionMs) break;
      this.events.shift();
    }

    // Drop oldest events beyond maxEvents.
    while (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }
}

/**
 * Creates an append-only audit log with hash-chain integrity protection,
 * payload redaction, and configurable retention.
 *
 * Fail-closed: append failures throw; integrity verification failures are
 * returned as false (never silently ignored).
 */
export function createAuditLog(config: AuditLogConfig = {}): AuditLog {
  return new AuditLogImpl({
    maxEvents: config.maxEvents ?? DEFAULT_MAX_EVENTS,
    retentionDays: config.retentionDays ?? DEFAULT_RETENTION_DAYS,
    now: () => new Date().toISOString(),
  });
}

/** Re-export types for consumers. */
export type { AuditEvent, AuditEventType, AuditRedactionLevel };
