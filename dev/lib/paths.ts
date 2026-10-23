import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Backend repo root (the directory holding package.json, `contracts/`, `dev/`). */
export const APP_ROOT = resolve(import.meta.dir, '..', '..');

function findDocs(): string {
  if (process.env.SPINDLE_DOCS_DIR) return resolve(process.env.SPINDLE_DOCS_DIR);
  // Works from `app/` and from `app/.worktrees/<task>/`.
  let dir = APP_ROOT;
  for (let i = 0; i < 5; i++) {
    const candidate = join(dir, 'docs', 'deploy');
    if (existsSync(candidate)) return join(dir, 'docs');
    dir = dirname(dir);
  }
  throw new Error('docs repo not found; set SPINDLE_DOCS_DIR');
}

export const DOCS_DIR = findDocs();
export const BACKEND_ENV_DEV = join(DOCS_DIR, 'deploy', 'backend.env.dev');
export const WEB_ENV_DEV = join(APP_ROOT, 'web', '.env.development.local');
export const CONTRACTS_DIR = join(APP_ROOT, 'contracts');
export const DEPLOYMENT_FILE = join(CONTRACTS_DIR, 'deployments', '4663-fork.json');
