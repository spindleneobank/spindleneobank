export type NavItem = { label: string; to: string };

export type NavMenuItem = NavItem & { note: string; hash?: string };
export type HeaderNavEntry =
  | { kind: 'link'; label: string; to: string }
  | {
      kind: 'menu';
      label: string;
      items: NavMenuItem[];
      aside?: { title: string; label: string; to: string };
    };

/** Marketing navigation. Solutions and Company are dropdown menus (as on the old site). */
export const HEADER_NAV: HeaderNavEntry[] = [
  { kind: 'link', label: 'Product', to: '/product' },
  {
    kind: 'menu',
    label: 'Solutions',
    items: [
      { label: 'GPU providers', note: 'Put compute to work', to: '/solutions', hash: 'gpu-providers' },
      { label: 'AI builders', note: 'Choose your compute lane', to: '/solutions', hash: 'ai-builders' },
      { label: 'Node operators', note: 'Manage verified work', to: '/solutions', hash: 'node-operators' },
      { label: 'Developers', note: 'Build with the API', to: '/developers' },
      { label: 'Payout choice', note: 'USDG, stocks or a card', to: '/solutions', hash: 'claims' },
    ],
  },
  { kind: 'link', label: 'Compute lanes', to: '/compute-lanes' },
  { kind: 'link', label: 'Verification', to: '/verification' },
  {
    kind: 'menu',
    label: 'Company',
    items: [
      { label: 'About', note: 'The compute and payout design', to: '/about' },
      { label: 'Field notes', note: 'Compute insights', to: '/blogs' },
      { label: 'Architecture', note: 'Explore the components', to: '/architecture' },
      { label: 'Case studies', note: 'Illustrative flows', to: '/case-study' },
      { label: 'Build notes', note: 'Architecture updates', to: '/changelog' },
      { label: 'Community', note: 'Telegram and X', to: '/community' },
      { label: 'Terms & Conditions', note: 'Preview and design limits', to: '/terms-conditions' },
      { label: 'Privacy Policy', note: 'Data-flow design', to: '/privacy-policy' },
    ],
    aside: { title: 'What’s New', label: 'Learn more', to: '/changelog' },
  },
];

/** Flat list of every header destination (mobile menu, tests). */
export const MAIN_NAV: NavItem[] = HEADER_NAV.flatMap((e) =>
  e.kind === 'link' ? [{ label: e.label, to: e.to }] : e.items.map(({ label, to }) => ({ label, to })),
);

export const FOOTER_NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Explore',
    items: [
      { label: 'Product', to: '/product' },
      { label: 'Solutions', to: '/solutions' },
      { label: 'Compute lanes', to: '/compute-lanes' },
      { label: 'Verification', to: '/verification' },
      { label: 'Developers', to: '/developers' },
      { label: 'About', to: '/about' },
    ],
  },
  {
    title: 'Resources',
    items: [
      { label: 'Field notes', to: '/blogs' },
      { label: 'Case studies', to: '/case-study' },
      { label: 'Architecture', to: '/architecture' },
      { label: 'Build notes', to: '/changelog' },
      { label: 'Community', to: '/community' },
    ],
  },
  {
    title: 'More',
    items: [
      { label: 'Privacy Policy', to: '/privacy-policy' },
      { label: 'Terms & Conditions', to: '/terms-conditions' },
      { label: 'Cookie Policy', to: '/cookie-policy' },
    ],
  },
];
