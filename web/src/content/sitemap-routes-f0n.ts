import { ROLES } from './about';
import { COMPONENTS } from './architecture';
import { POSTS } from './blogs';
import { FLOWS } from './case-study';

/** F0n sitemap entries. F6 builds sitemap.xml from these plus the F0m list. */
export const F0N_SITEMAP_ROUTES: string[] = [
  '/about',
  ...ROLES.map((r) => `/about/${r.slug}`),
  '/community',
  '/changelog',
  '/blogs',
  ...POSTS.map((p) => `/blogs/${p.slug}`),
  '/case-study',
  ...FLOWS.map((f) => `/case-study/${f.slug}`),
  '/architecture',
  ...COMPONENTS.map((c) => `/architecture/${c.slug}`),
  '/privacy-policy',
  '/cookie-policy',
  '/terms-conditions',
];
