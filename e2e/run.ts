// bun run e2e [--only 1,3] [--reset]   Drives the 13 scenarios in docs/plan/verification.md against the dev stack.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVIDENCE } from './lib/env';
import { makeCtx, type Scenario, Skip } from './lib/harness';
import { s01 } from './scenarios/s01';
import { s02 } from './scenarios/s02';
import { s03 } from './scenarios/s03';
import { s04 } from './scenarios/s04';
import { s05 } from './scenarios/s05';

const all: Scenario[] = [s01, s02, s03, s04, s05];
const only = (
  process.argv.find((a) => a.startsWith('--only='))?.slice(7) ??
  process.argv[process.argv.indexOf('--only') + 1] ??
  ''
)
  .split(',')
  .filter((x) => /^\d+$/.test(x))
  .map(Number);

const rows: { n: number; name: string; status: string; ms: number; detail: string }[] = [];
for (const s of all) {
  if (only.length && !only.includes(s.n)) continue;
  const c = makeCtx(s.n);
  const t0 = Date.now();
  console.log(`== scenario ${s.n}: ${s.name}`);
  try {
    await s.run(c);
    rows.push({ n: s.n, name: s.name, status: 'PASS', ms: Date.now() - t0, detail: '' });
  } catch (e) {
    const status = e instanceof Skip ? 'SKIP' : 'FAIL';
    const msg = e instanceof Error ? e.message : String(e);
    c.step(`${status}: ${msg}`);
    rows.push({ n: s.n, name: s.name, status, ms: Date.now() - t0, detail: msg.slice(0, 400) });
  }
}
const table = rows
  .map(
    (r) =>
      `| ${r.n} | ${r.name} | ${r.status} | ${(r.ms / 1000).toFixed(0)}s | ${r.detail.replace(/\|/g, '/').replace(/\n/g, ' ')} |`,
  )
  .join('\n');
console.log(`\n| # | scenario | result | time | detail |\n|---|---|---|---|---|\n${table}`);
if (!only.length)
  writeFileSync(
    join(EVIDENCE, 'REPORT.md'),
    `# E2E run ${new Date().toISOString()}\n\n| # | scenario | result | time | detail |\n|---|---|---|---|---|\n${table}\n`,
  );
process.exit(rows.some((r) => r.status === 'FAIL') ? 1 : 0);
