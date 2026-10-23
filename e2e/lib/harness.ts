import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './env';

export type Ctx = {
  n: number;
  dir: string;
  step: (msg: string) => void;
  ev: (name: string, data: unknown) => void;
  note: (msg: string) => void;
};
export type Scenario = { n: number; name: string; run: (c: Ctx) => Promise<void> };
export class Skip extends Error {}

const STATE = join(import.meta.dir, '..', '.state.json');
export const state = {
  get<T = any>(k: string): T | undefined {
    try {
      return JSON.parse(readFileSync(STATE, 'utf8'))[k];
    } catch {
      return undefined;
    }
  },
  set(k: string, v: unknown) {
    let cur: Record<string, unknown> = {};
    if (existsSync(STATE)) cur = JSON.parse(readFileSync(STATE, 'utf8'));
    cur[k] = v;
    writeFileSync(STATE, JSON.stringify(cur, null, 2), { mode: 0o600 });
  },
};

const redact = (v: unknown): unknown =>
  JSON.parse(
    JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x)).replace(
      /sk-spdl-[A-Za-z0-9_-]+/g,
      'sk-spdl-REDACTED',
    ),
  );

export function makeCtx(n: number): Ctx {
  const dir = join(EVIDENCE, String(n));
  mkdirSync(dir, { recursive: true });
  const logLines: string[] = [];
  const flush = () => writeFileSync(join(dir, 'log.txt'), `${logLines.join('\n')}\n`);
  return {
    n,
    dir,
    step: (m) => {
      const l = `[${new Date().toISOString()}] ${m}`;
      logLines.push(l);
      console.log(`  s${n} ${m}`);
      flush();
    },
    note: (m) => {
      logLines.push(`NOTE ${m}`);
      flush();
    },
    ev: (name, data) => {
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(redact(data), null, 2));
    },
  };
}
export function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}
export function eq<T>(a: T, b: T, msg: string) {
  if (a !== b) throw new Error(`ASSERT ${msg}: got ${String(a)} expected ${String(b)}`);
}
