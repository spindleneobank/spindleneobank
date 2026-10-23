import { absoluteUrl } from './seo';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function buildSitemap(appUrl: string, routes: string[]): string {
  const urls = routes.map((r) => `  <url><loc>${esc(absoluteUrl(appUrl, r))}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function buildRobots(appUrl: string, base: string): string {
  return `${base.trimEnd()}\nSitemap: ${absoluteUrl(appUrl, '/sitemap.xml')}\n`;
}
