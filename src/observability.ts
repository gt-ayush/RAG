export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEvent {
  level: LogLevel;
  event: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface Logger {
  log(level: LogLevel, event: string, data?: Record<string, unknown>): void;
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

const SENSITIVE_KEY_PATTERN = /(api[-_]?key|authorization|token|secret|password|cookie|prompt|evidence|content|document|chunk)/i;

function sanitizeValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 256 ? `${value.slice(0, 256)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  if (typeof value === 'object') return '[object]';
  return String(value);
}

export function sanitizeLogData(data: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    out[key] = sanitizeValue(key, value);
  }
  return out;
}

export function createStructuredLogger(sink: (event: LogEvent) => void = (e) => console.log(JSON.stringify(e))): Logger {
  const log = (level: LogLevel, event: string, data?: Record<string, unknown>) => {
    sink({
      level,
      event,
      timestamp: new Date().toISOString(),
      ...(data ? { data: sanitizeLogData(data) } : {}),
    });
  };
  return {
    log,
    debug: (event, data) => log('debug', event, data),
    info: (event, data) => log('info', event, data),
    warn: (event, data) => log('warn', event, data),
    error: (event, data) => log('error', event, data),
  };
}

export class MetricsRecorder {
  private readonly counters = new Map<string, number>();
  private readonly timings = new Map<string, number[]>();

  increment(name: string, value = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + value);
  }

  timing(name: string, durationMs: number): void {
    const arr = this.timings.get(name) ?? [];
    arr.push(durationMs);
    this.timings.set(name, arr);
  }

  snapshot(): { counters: Record<string, number>; timings: Record<string, { count: number; min: number; max: number; avg: number }> } {
    const counters: Record<string, number> = Object.fromEntries(this.counters.entries());
    const timings: Record<string, { count: number; min: number; max: number; avg: number }> = {};
    for (const [name, values] of this.timings.entries()) {
      const count = values.length;
      const min = count ? Math.min(...values) : 0;
      const max = count ? Math.max(...values) : 0;
      const avg = count ? values.reduce((a, b) => a + b, 0) / count : 0;
      timings[name] = { count, min, max, avg };
    }
    return { counters, timings };
  }
}
