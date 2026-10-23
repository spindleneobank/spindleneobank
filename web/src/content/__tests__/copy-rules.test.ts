import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Site-wide copy rules (Overview PDF s9 "What not to say"). Scans the source text of every content file,
 * marketing component, route and dashboard feature, and the prerendered marketing HTML when a build exists.
 */
const SRC = join(import.meta.dirname, '..', '..');
const DIST = join(SRC, '..', 'dist', 'client');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'mock') continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

// Allowlist (path fragment -> why). The icon sprite names a "passkey" glyph; it is never rendered as copy.
// features/marketing/p8/data.ts holds the old legal copy verbatim (owner decision); its only hit is the disclaimer "No partnership ... is implied".
const ALLOW_FILES = ['components/pixelIcons.data.ts', 'features/marketing/p8/data.ts'];
const sourceFiles = ['content', 'components', 'routes', 'dashboard', 'features']
  .flatMap((d) => walk(join(SRC, d)))
  .filter((f) => !ALLOW_FILES.some((a) => f.endsWith(a)));
const sources = sourceFiles.map((f) => ({ name: relative(SRC, f), text: readFileSync(f, 'utf8') }));

function htmlPages(dir: string, out: { name: string; text: string }[] = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '_app' || name === 'assets' || name === 'fonts') continue;
      htmlPages(p, out);
    } else if (name.endsWith('.html') && !name.startsWith('_shell')) {
      const html = readFileSync(p, 'utf8')
        .replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ')
        .replace(/<[^>]+>/g, ' ');
      out.push({ name: relative(DIST, p), text: html });
    }
  }
  return out;
}
const pages = existsSync(DIST) ? htmlPages(DIST) : [];
const corpus = [...sources, ...pages];

const FORBIDDEN: [string, RegExp][] = [
  ['passkey', /passkey/i],
  ['smart account', /smart[- ]?account/i],
  ['paymaster', /paymaster/i],
  ['passive income', /passive income/i],
  ['APY', /\bAPY\b/],
  ['per GPU per month', /per GPU per month/i],
  ['prepaid', /prepaid/i],
  ['reloadable', /reloadable/i],
  ['partner', /partner/i],
  ['claimStock', /claimStock/],
  ['consumeForCard', /consumeForCard/],
  ['refundCard', /refundCard/],
  ['instant card claim', /instant card claim/i],
  ['no email', /no email/i],
  ['no account', /no account/i],
  [
    'earnings projection',
    /\b(earn|make)\s+up to\b|estimated (monthly )?earnings|projected (monthly )?earnings/i,
  ],
  ['guaranteed earnings', /guaranteed (earnings|income|returns?|payouts?)/i],
  [
    'claim straight to card',
    /claims?\s+(directly\s+|straight\s+)?(to|onto|into)\s+(a|your|the)\s+(virtual\s+)?card/i,
  ],
  [
    'brand partner',
    /(Robinhood|NVIDIA|Visa|Mastercard|Apple|Google)[^.]{0,40}partner|partner[^.]{0,40}(Robinhood|NVIDIA|Visa|Mastercard|Apple|Google)/i,
  ],
];

describe('site-wide copy rules', () => {
  it('scans source and (when built) rendered HTML', () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((s) => s.name.startsWith('content/'))).toBe(true);
    expect(sources.some((s) => s.name.startsWith('features/'))).toBe(true);
  });

  it.each(FORBIDDEN)('contains no "%s"', (_n, re) => {
    const hits = corpus.filter((s) => re.test(s.text)).map((s) => s.name);
    expect(hits).toEqual([]);
  });

  it('never calls consumer GPUs confidential', () => {
    const offenders: string[] = [];
    for (const { name, text } of corpus) {
      // "consumer GPUs are confidential" style claims; negations ("not confidential", "non-confidential") pass.
      for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
        if (!/(consumer|RTX|GeForce)[^.,;]{0,40}confidential/i.test(sentence)) continue;
        if (!/\bnot\b|non-confidential|n't|never|cannot/i.test(sentence))
          offenders.push(`${name}: ${sentence.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps every sealed-lane page labelled "in testing"', () => {
    const missing = corpus
      .filter((s) => /sealed[- ]lane|sealed lane/i.test(s.text))
      .filter((s) => !/in testing/i.test(s.text))
      // Dashboard/feature code may reference the lane id only; they must still not claim it is live.
      .filter(
        (s) =>
          !s.name.startsWith('features/') &&
          !s.name.startsWith('dashboard/') &&
          !s.name.startsWith('routes/'),
      )
      // Redirect stubs only link to a sealed-lane slug.
      .filter((s) => !/This page has moved/.test(s.text))
      .map((s) => s.name);
    expect(missing).toEqual([]);
  });

  it('never says the sealed lane is live or generally available', () => {
    const hits = corpus.filter((s) =>
      /sealed[^.]{0,40}\b(is|now) (live|generally available|production-ready)/i.test(s.text),
    );
    expect(hits.map((s) => s.name)).toEqual([]);
  });

  it('states the honest limits (Overview s10)', () => {
    const all = sources
      .filter((s) => s.name.startsWith('content/'))
      .map((s) => s.text)
      .join('\n');
    expect(all).toMatch(
      /open lane is not private from the (node )?operator|Open-lane work is visible to the node operator/i,
    );
    expect(all).toMatch(/sealed[^.]{0,80}in testing/i);
    expect(all).toMatch(/TDX/);
    expect(all).toMatch(/does not prove the output was correct|not prove the answer was/i);
    expect(all).toMatch(/Stock Tokens? .{0,80}no shareholder rights|no shareholder rights/i);
    expect(all).toMatch(/issued by a third-party card program/i);
  });

  it('routes claims to the wallet first', () => {
    const home = sources.find((s) => s.name === 'content/marketing/home.ts')?.text ?? '';
    expect(home).toMatch(/Claims always go to your wallet first/);
  });
});
