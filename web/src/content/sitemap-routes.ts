import { F0N_SITEMAP_ROUTES } from './sitemap-routes-f0n';

/** F0m marketing routes (the old static sitemap listed these plus the Framer-era pages that moved). */
export const F0M_SITEMAP_ROUTES: string[] = [
  '/',
  '/product',
  '/solutions',
  '/compute-lanes',
  '/verification',
  '/developers',
];

/** Indexable routes only: redirects, /404 and /dashboard/* are excluded on purpose. */
export const SITEMAP_ROUTES: string[] = [...new Set([...F0M_SITEMAP_ROUTES, ...F0N_SITEMAP_ROUTES])];
