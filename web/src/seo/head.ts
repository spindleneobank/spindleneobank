import { env } from '../env';
import { buildHead, type HeadInput, organizationJsonLd } from './seo';

/** head() for a route, using VITE_APP_URL as the canonical host. Home gets the Organization JSON-LD. */
export function routeHead(input: Omit<HeadInput, 'base'>) {
  const base = env.appUrl;
  const jsonLd = input.jsonLd ?? (input.path === '/' ? organizationJsonLd(base) : undefined);
  return buildHead({ ...input, base, jsonLd });
}
