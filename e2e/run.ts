// bun run e2e [--only 1,3] [--reset]   Drives the 13 scenarios in docs/plan/verification.md against the dev stack.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pub } from './lib/chain';
import { EVIDENCE } from './lib/env';
import { makeCtx, type Scenario, Skip } from './lib/harness';
import { s01 } from './scenarios/s01';
import { s02 } from './scenarios/s02';
import { s03 } from './scenarios/s03';
import { s04 } from './scenarios/s04';
import { s05 } from './scenarios/s05';
import { s06 } from './scenarios/s06';
import { s07 } from './scenarios/s07';
import { s08 } from './scenarios/s08';
import { s09 } from './scenarios/s09';
import { s10 } from './scenarios/s10';
import { s11 } from './scenarios/s11';
import { s12 } from './scenarios/s12';
import { s13 } from './scenarios/s13';

const all: Scenario[] = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13];
const only = (
  process.argv.find((a) => a.startsWith('--only='))?.slice(7) ??
  process.argv[process.argv.indexOf('--only') + 1] ??
  ''
)
  .split(',')
  .filter((x) => /^\d+$/.test(x))
  .map(Number);

import { checkDevFlags, ensureHouse, resetStack } from './lib/stack';

if (process.argv.includes('--reset')) await resetStack();
if (!(await checkDevFlags()))
  console.log('harness flag missing: SPINDLE_DEV_LAZY / SPINDLE_DEV_FAKE_GPU not in node/src/config.ts');
await ensureHouse((m) => console.log(`  stack ${m}`));

const rows: { n: number; name: string; status: string; ms: number; detail: string }[] = [];
// scenarios 6 and 7 warp the chain clock by hours; x402 signatures carry wall-clock deadlines, so every scenario that
// pays via x402 (4, 5, 13) must run before them. Results are reported in scenario-number order.
const ORDER = [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13, 6, 7];
const NEEDS_FRESH_CLOCK = [4, 5, 13];
const sorted = [...all].sort((a, b) => ORDER.indexOf(a.n) - ORDER.indexOf(b.n));
for (const s of sorted) {
  if (only.length && !only.includes(s.n)) continue;
  const c = makeCtx(s.n);
  const t0 = Date.now();
  if (NEEDS_FRESH_CLOCK.includes(s.n)) {
    const ahead =
      Number((await pub.getBlock({ blockTag: 'latest' })).timestamp) - Math.floor(Date.now() / 1000);
    if (ahead > 120) {
      const msg = `chain clock is ${ahead}s ahead of wall time (an earlier run warped it): x402 deadlines are already expired. Run with --reset`;
      c.step(`FAIL: ${msg}`);
      rows.push({ n: s.n, name: s.name, status: 'FAIL', ms: 0, detail: msg });
      continue;
    }
  }
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
rows.sort((a, b) => a.n - b.n);
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
