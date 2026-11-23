import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const cfg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'vercel.json'), 'utf8')) as {
  cleanUrls?: boolean;
  rewrites?: { source: string; destination: string }[];
};

describe('vercel.json', () => {
  it('rewrites the dashboard to the client shell', () => {
    const dests = (cfg.rewrites ?? [])
      .filter((r) => r.source.startsWith('/dashboard'))
      .map((r) => r.destination);
    expect(dests.length).toBeGreaterThan(0);
    for (const d of dests) expect(d).toBe('/_shell');
  });

  it('never rewrites to an .html path while cleanUrls is on (Vercel serves those files without the extension)', () => {
    if (!cfg.cleanUrls) return;
    for (const r of cfg.rewrites ?? []) expect(r.destination.endsWith('.html'), r.destination).toBe(false);
  });
});
