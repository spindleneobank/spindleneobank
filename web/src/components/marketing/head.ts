import { routeHead } from '../../seo/head';
import type { PageMeta } from './types';

/** Per-route head(): title, description, canonical (VITE_APP_URL), Open Graph. See `src/seo`. */
export function pageHead({ title, description, path }: PageMeta) {
  return routeHead({ title, description, path });
}
