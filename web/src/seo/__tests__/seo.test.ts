import { describe, expect, it } from 'vitest';
import { SITEMAP_ROUTES } from '../../content/sitemap-routes';
import { F0N_SITEMAP_ROUTES } from '../../content/sitemap-routes-f0n';
import { buildHead, organizationJsonLd } from '../seo';
import { buildRobots, buildSitemap } from '../sitemap';

const base = 'https://spindle.example';

describe('buildHead', () => {
  it('adds the site name, absolute canonical and OG image', () => {
    const h = buildHead({ base, title: 'Product', description: 'd', path: '/product' });
    expect(h.meta).toContainEqual({ title: 'Product | Spindle' });
    expect(h.links).toEqual([{ rel: 'canonical', href: `${base}/product` }]);
    expect(h.meta).toContainEqual({ property: 'og:image', content: `${base}/assets/brand/banner.webp` });
  });
  it('does not double the site name and canonicalises home without a slash', () => {
    const h = buildHead({ base: `${base}/`, title: 'Spindle: x', description: 'd', path: '/' });
    expect(h.meta).toContainEqual({ title: 'Spindle: x' });
    expect(h.links[0]?.href).toBe(base);
  });
  it('supports noindex and JSON-LD', () => {
    const h = buildHead({
      base,
      title: 'x',
      description: 'd',
      path: '/x',
      noindex: true,
      jsonLd: organizationJsonLd(base),
    });
    expect(h.meta).toContainEqual({ name: 'robots', content: 'noindex' });
    expect(h.meta.some((m) => 'script:ld+json' in m)).toBe(true);
  });
  it('lists the official channels as sameAs', () => {
    expect(organizationJsonLd(base).sameAs).toEqual([
      'https://github.com/spindleneobank/spindleneobank',
      'https://t.me/spindleneobank',
      'https://x.com/spindleneobank',
    ]);
  });
});

describe('sitemap and robots', () => {
  it('lists every F0n route plus the core pages, never the dashboard', () => {
    for (const r of F0N_SITEMAP_ROUTES) expect(SITEMAP_ROUTES).toContain(r);
    for (const r of ['/', '/product', '/solutions', '/compute-lanes', '/verification', '/developers'])
      expect(SITEMAP_ROUTES).toContain(r);
    expect(SITEMAP_ROUTES.some((r) => r.startsWith('/dashboard'))).toBe(false);
    expect(new Set(SITEMAP_ROUTES).size).toBe(SITEMAP_ROUTES.length);
  });
  it('uses the production host', () => {
    const xml = buildSitemap(base, ['/', '/product']);
    expect(xml).toContain(`<loc>${base}</loc>`);
    expect(xml).toContain(`<loc>${base}/product</loc>`);
    expect(buildRobots(base, 'User-agent: *\nDisallow: /dashboard\n')).toContain(
      `Sitemap: ${base}/sitemap.xml`,
    );
  });
});
