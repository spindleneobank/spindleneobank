// Host-run test wrapper: reads Postgres creds from ../docs/deploy/backend.env.dev at runtime (never printed),
// points the suites at the host-published dev stack (7XXX ports) and runs `bun test`.
//   bun run test:host           unit suite (src + dev, *.int.test.ts excluded by bunfig)
//   bun run test:host --int     integration suites (need the anvil fork; they skip when it is unhealthy)
// Extra args are forwarded to `bun test`. Variables already set in the shell win.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// ../docs from the repo root; also works from a git worktree under app/.worktrees/<name>.
function findEnvFile(): string {
  let dir = new URL('..', import.meta.url).pathname;
  for (let i = 0; i < 6; i++, dir = dirname(dir)) {
    const f = join(dir, '..', 'docs', 'deploy', 'backend.env.dev');
    if (existsSync(f)) return f;
  }
  throw new Error('docs/deploy/backend.env.dev not found');
}
const envFile = findEnvFile();
const vars: Record<string, string> = {};
for (const line of readFileSync(envFile, 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) vars[m[1] as string] = (m[2] as string).replace(/^(['"])(.*)\1$/, '$2');
}
const user = process.env.POSTGRES_USER ?? vars.POSTGRES_USER;
const pass = process.env.POSTGRES_PASSWORD ?? vars.POSTGRES_PASSWORD;
if (!user || !pass) throw new Error(`POSTGRES_USER/POSTGRES_PASSWORD missing in ${envFile}`);

const args = process.argv.slice(2);
const int = args.includes('--int');
const rest = args.filter((a) => a !== '--int');

const env = {
  ...process.env,
  TEST_DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    `postgres://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@127.0.0.1:7232/spindle_test`,
  REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:7279',
  RPC_URLS: process.env.RPC_URLS ?? 'http://127.0.0.1:7245',
  IZIPAY_BASE_URL: process.env.IZIPAY_BASE_URL ?? 'http://127.0.0.1:7290/api/v1',
};
// bunfig ignores *.int.test.ts for the unit run; the integration run overrides the ignore list.
const cmd = int
  ? ['bun', 'test', '--path-ignore-patterns=node_modules/**', ...(rest.length ? rest : ['.int.test.ts'])]
  : ['bun', 'test', ...(rest.length ? rest : ['src', 'dev'])];
const proc = Bun.spawn(cmd, {
  env,
  stdout: 'inherit',
  stderr: 'inherit',
  cwd: new URL('..', import.meta.url).pathname,
});
process.exit(await proc.exited);
