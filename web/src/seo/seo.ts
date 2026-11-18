/** Single source for per-route <head>: title template, description, canonical, OG/Twitter, JSON-LD. */
import { SOCIALS } from '../components/marketing/shell/nav-data';

export const SITE_NAME = 'Spindle';
export const OG_IMAGE_PATH = '/assets/brand/banner.webp';

export type HeadInput = {
  title: string;
  description: string;
  /** Route path, e.g. `/product`. */
  path: string;
  noindex?: boolean;
  /** Meta-refresh fallback for moved routes (vercel.json carries the real 301). */
  refreshTo?: string;
  jsonLd?: Record<string, unknown>;
  /** Base URL override (tests); defaults to VITE_APP_URL. */
  base?: string;
};

export function withSiteName(title: string): string {
  return /\bSpindle\b/.test(title) ? title : `${title} | ${SITE_NAME}`;
}

export function absoluteUrl(base: string, path: string): string {
  const b = base.replace(/\/$/, '');
  return `${b}${path === '/' ? '' : path}`;
}

export function organizationJsonLd(base: string): Record<string, unknown> {
  const b = base.replace(/\/$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: b,
    logo: `${b}/assets/brand/mark.svg`,
    description:
      'Spindle connects GPU supply to AI demand, records verified work, and pays providers in USDG.',
    sameAs: SOCIALS.map((s) => s.href),
  };
}

export function buildHead(input: HeadInput & { base: string }) {
  const title = withSiteName(input.title);
  const url = absoluteUrl(input.base, input.path);
  const image = `${input.base.replace(/\/$/, '')}${OG_IMAGE_PATH}`;
  const meta: Record<string, unknown>[] = [
    { title },
    { name: 'description', content: input.description },
    { property: 'og:site_name', content: SITE_NAME },
    { property: 'og:title', content: title },
    { property: 'og:description', content: input.description },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: url },
    { property: 'og:image', content: image },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:description', content: input.description },
    { name: 'twitter:image', content: image },
  ];
  if (input.noindex) meta.push({ name: 'robots', content: 'noindex' });
  if (input.refreshTo) meta.push({ httpEquiv: 'refresh', content: `0; url=${input.refreshTo}` });
  if (input.jsonLd) meta.push({ 'script:ld+json': input.jsonLd });
  return {
    meta,
    links: [{ rel: 'canonical', href: input.refreshTo ? absoluteUrl(input.base, input.refreshTo) : url }],
  };
}
