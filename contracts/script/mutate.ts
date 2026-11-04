/**
 * Mutation test for the core contracts: applies one small change at a time to `src/*.sol` in a scratch copy and
 * checks the test suite catches it. A mutant that does not compile is not counted.
 *
 *   bun run contracts/script/mutate.ts [--workers 4] [--out report.json]
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FILES = ['BuyerVault.sol', 'SpindleClaims.sol', 'SpindleRegistry.sol', 'SpindleStaking.sol'];
const RULES: [string, RegExp, string][] = [
  ['eq-to-ne', / == /, ' != '],
  ['ne-to-eq', / != /, ' == '],
  ['le-to-lt', / <= /, ' < '],
  ['ge-to-gt', / >= /, ' > '],
  ['lt-to-le', / < /, ' <= '],
  ['gt-to-ge', / > /, ' >= '],
  ['add-to-sub', / \+ /, ' - '],
  ['sub-to-add', / - /, ' + '],
  ['mul-to-div', / \* /, ' / '],
  ['div-to-mul', / \/ /, ' * '],
  ['addeq-to-subeq', / \+= /, ' -= '],
  ['subeq-to-addeq', / -= /, ' += '],
  ['and-to-or', / && /, ' || '],
  ['or-to-and', / \|\| /, ' && '],
  ['true-to-false', /\btrue\b/, 'false'],
  ['false-to-true', /\bfalse\b/, 'true'],
  ['if-never', /\bif \((.*)\) (revert|return)\b/, 'if (false) $2'],
  ['if-always', /\bif \((.*)\) (revert|return)\b/, 'if (true) $2'],
  ['drop-nonreentrant', / nonReentrant\b/, ''],
  ['drop-only-modifier', / only[A-Z]\w*\b(?=[^(]*\{)/, ''],
];

export interface Mutant {
  file: string;
  line: number;
  rule: string;
  from: string;
  to: string;
}

/** Every mutant of a source: one rule, one line. Comments and declarations that cannot change behaviour are skipped. */
export function mutantsOf(file: string, source: string): (Mutant & { source: string })[] {
  const lines = source.split('\n');
  const out: (Mutant & { source: string })[] = [];
  lines.forEach((text, i) => {
    const t = text.trim();
    if (!t || /^(\/\/|\/\*|\*|pragma\b|import\b|event\b|error\b|using\b)/.test(t)) return;
    for (const [rule, re, sub] of RULES) {
      if (!re.test(text)) continue;
      const to = text.replace(re, sub);
      if (to === text) continue;
      const mutated = [...lines];
      mutated[i] = to;
      out.push({ file, line: i + 1, rule, from: t, to: to.trim(), source: mutated.join('\n') });
    }
  });
  return out;
}

const ENV = {
  ...process.env,
  FOUNDRY_INVARIANT_RUNS: '10',
  FOUNDRY_INVARIANT_DEPTH: '50',
  FOUNDRY_FUZZ_RUNS: '64',
};

async function run(cwd: string, args: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(['forge', ...args], { cwd, env: ENV, stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out + err };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opt = (n: string, d: string) =>
    argv.includes(`--${n}`) ? (argv[argv.indexOf(`--${n}`) + 1] as string) : d;
  const workers = Number(opt('workers', '4'));
  const outFile = opt('out', 'mutation-report.json');
  const root = new URL('..', import.meta.url).pathname;
  const queue = FILES.flatMap((f) => mutantsOf(f, readFileSync(join(root, 'src', f), 'utf8')));
  const total = queue.length;
  const killed: Mutant[] = [];
  const survived: Mutant[] = [];
  let invalid = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      const dir = mkdtempSync(join(process.env.MUTATE_TMP ?? tmpdir(), 'mutate-'));
      cpSync(root, dir, {
        recursive: true,
        filter: (s) => !/\/(cache|out|broadcast)(\/|$)/.test(s.slice(root.length)),
      });
      if ((await run(dir, ['build'])).code !== 0) throw new Error('baseline does not build');
      for (let m = queue.shift(); m; m = queue.shift()) {
        const path = join(dir, 'src', m.file);
        const original = readFileSync(path, 'utf8');
        writeFileSync(path, m.source);
        const built = await run(dir, ['build']);
        const { source: _s, ...info } = m;
        if (built.code !== 0) invalid++;
        else if ((await run(dir, ['test', '--no-match-path', 'test/fork/*'])).code === 0) survived.push(info);
        else killed.push(info);
        writeFileSync(path, original);
        const done = total - queue.length;
        if (done % 10 === 0)
          console.log(
            `${done}/${total} killed=${killed.length} survived=${survived.length} invalid=${invalid}`,
          );
      }
      rmSync(dir, { recursive: true, force: true });
    }),
  );
  const counted = killed.length + survived.length;
  const score = counted ? (killed.length / counted) * 100 : 0;
  writeFileSync(
    outFile,
    JSON.stringify({ total, counted, killed: killed.length, invalid, score, survived }, null, 2),
  );
  console.log(`score ${score.toFixed(1)}%: ${killed.length}/${counted} killed, ${invalid} did not compile`);
}

if (import.meta.main) await main();
