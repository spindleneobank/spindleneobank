import { describe, expect, it } from 'vitest';
import { SOCIALS } from '../../../../components/marketing/shell/nav-data';
import { applyExceptions } from '../exceptions';
import { trees } from '../markup';

describe('verification page social links', () => {
  it.each(Object.entries(trees))('%s tree links every channel and has no coming-soon button', (_bp, html) => {
    const out = applyExceptions(html);
    expect(out).not.toMatch(/COMING SOON/);
    expect(out).not.toMatch(/<button[^>]*data-sp-social/);
    for (const s of SOCIALS.filter((x) => html.includes(`data-sp-social="${x.key}"`))) {
      expect(out).toContain(
        `<a href="${s.href}" target="_blank" rel="noopener noreferrer" data-sp-social="${s.key}"`,
      );
    }
  });
});
