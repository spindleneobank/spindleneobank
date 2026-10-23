import { env } from '../../env';
import type { PageMeta } from './types';

const OG_IMAGE = '/assets/brand/banner.webp';

/** Per-route head(): title, description, canonical (VITE_APP_URL), Open Graph. */
export function pageHead({ title, description, path }: PageMeta) {
  const base = env.appUrl.replace(/\/$/, '');
  const url = `${base}${path === '/' ? '' : path}`;
  return {
    meta: [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { property: 'og:url', content: url },
      { property: 'og:image', content: `${base}${OG_IMAGE}` },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
