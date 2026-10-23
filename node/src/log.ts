const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
export type LogLevel = keyof typeof LEVELS;

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export function createLogger(level: LogLevel = 'info', sink: (line: string) => void = console.log): Logger {
  const min = LEVELS[level];
  const emit = (l: LogLevel, msg: string, extra?: unknown) => {
    if (LEVELS[l] < min) return;
    const tail = extra === undefined ? '' : ` ${typeof extra === 'string' ? extra : safeJson(extra)}`;
    sink(`${new Date().toISOString()} ${l.toUpperCase().padEnd(5)} ${msg}${tail}`);
  };
  return {
    debug: (m, e) => emit('debug', m, e),
    info: (m, e) => emit('info', m, e),
    warn: (m, e) => emit('warn', m, e),
    error: (m, e) => emit('error', m, e),
  };
}

function safeJson(v: unknown): string {
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
