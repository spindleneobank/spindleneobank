import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Parses KEY=VALUE lines (comments and blanks ignored). */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1] as string] = m[2] as string;
  }
  return out;
}

export function readEnvFile(path: string): Record<string, string> {
  return existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {};
}

/**
 * Sets KEY=VALUE pairs, preserving every other line (comments, order, unknown keys).
 * Existing keys are replaced in place; new keys are appended. Returns the keys that actually changed.
 * An existing file keeps its mode (writeFileSync does not chmod); a new file is created 0600.
 */
export function updateEnvFile(path: string, updates: Record<string, string>): string[] {
  const existed = existsSync(path);
  const lines = existed ? readFileSync(path, 'utf8').split('\n') : [];
  const changed: string[] = [];
  const pending = new Map(Object.entries(updates));
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(lines[i] as string);
    const key = m?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key) as string;
      pending.delete(key);
      if (m?.[2] !== value) {
        lines[i] = `${key}=${value}`;
        changed.push(key);
      }
    }
  }
  if (pending.size) {
    // keep a trailing newline: insert before the final empty element
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (const [key, value] of pending) {
      lines.push(`${key}=${value}`);
      changed.push(key);
    }
    lines.push('');
  }
  if (changed.length || !existed) writeFileSync(path, lines.join('\n'), { mode: 0o600 });
  return changed;
}
