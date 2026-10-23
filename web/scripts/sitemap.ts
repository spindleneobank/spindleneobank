/**
 * Post-build: writes dist/client/sitemap.xml (from src/content/sitemap-routes.ts, host from VITE_APP_URL)
 * and appends the Sitemap line to the copied robots.txt. Fails if a listed route was not prerendered.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from 'vite';
import { SITEMAP_ROUTES } from '../src/content/sitemap-routes';
import { buildRobots, buildSitemap } from '../src/seo/sitemap';

const root = join(import.meta.dirname, '..');
const env = { ...loadEnv(process.env.MODE ?? 'production', root, 'VITE_'), ...process.env };
const appUrl = env.VITE_APP_URL;
if (!appUrl) throw new Error('VITE_APP_URL is required to build sitemap.xml');
const out = join(root, 'dist', 'client');

for (const r of SITEMAP_ROUTES) {
  const f = r === '/' ? join(out, 'index.html') : join(out, r, 'index.html');
  if (!existsSync(f)) throw new Error(`sitemap route ${r} was not prerendered (${f})`);
}
// Every indexable page needs a unique title + description and an absolute canonical on the production host.
const seen = { title: new Map<string, string>(), description: new Map<string, string>() };
for (const r of SITEMAP_ROUTES) {
  const html = readFileSync(r === '/' ? join(out, 'index.html') : join(out, r, 'index.html'), 'utf8');
  const title = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]*)"/)?.[1];
  const canonical = html.match(/<link rel="canonical" href="([^"]*)"/)?.[1];
  if (!title || !description) throw new Error(`${r}: missing title or description`);
  if (canonical !== `${appUrl.replace(/\/$/, '')}${r === '/' ? '' : r}`)
    throw new Error(`${r}: bad canonical ${canonical}`);
  for (const [k, v] of [
    ['title', title],
    ['description', description],
  ] as const) {
    const prev = seen[k].get(v);
    if (prev) throw new Error(`${r}: duplicate ${k} (also ${prev})`);
    seen[k].set(v, r);
  }
}
writeFileSync(join(out, 'sitemap.xml'), buildSitemap(appUrl, SITEMAP_ROUTES));
writeFileSync(
  join(out, 'robots.txt'),
  buildRobots(appUrl, readFileSync(join(root, 'public', 'robots.txt'), 'utf8')),
);
console.log(`[sitemap] ${SITEMAP_ROUTES.length} routes -> ${join(out, 'sitemap.xml')} (${appUrl})`);
