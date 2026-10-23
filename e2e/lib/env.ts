// E2E environment: host-published dev stack ports. Reads docs/deploy/backend.env.dev at runtime (values never printed).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function find(): string {
  let dir = new URL('../..', import.meta.url).pathname;
  for (let i = 0; i < 6; i++, dir = dirname(dir)) {
    const f = join(dir, '..', 'docs', 'deploy', 'backend.env.dev');
    if (existsSync(f)) return f;
  }
  throw new Error('docs/deploy/backend.env.dev not found');
}
export const ENV_FILE = find();
export const DOCS = join(dirname(dirname(ENV_FILE)), '');
export const REPO = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
export const vars: Record<string, string> = {};
for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) vars[m[1] as string] = (m[2] as string).replace(/^(['"])(.*)\1$/, '$2');
}
export const API = process.env.E2E_API_URL ?? 'http://127.0.0.1:7200';
export const RPC = process.env.E2E_RPC_URL ?? 'http://127.0.0.1:7245';
export const MOCK = process.env.E2E_MOCK_URL ?? 'http://127.0.0.1:7290';
/** SIWE origin: must be in CORS_ORIGINS and SIWE_ALLOWED_DOMAINS. */
export const ORIGIN = process.env.E2E_ORIGIN ?? 'http://localhost:7000';
export const EVIDENCE = process.env.E2E_EVIDENCE ?? join(DOCS, 'testing', 'e2e');
export const addr = (k: string) => {
  const v = vars[k];
  if (!v) throw new Error(`${k} missing in backend.env.dev`);
  return v.toLowerCase() as `0x${string}`;
};
