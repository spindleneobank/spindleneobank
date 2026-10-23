export type NavItem = { label: string; to: string };

/** Marketing navigation. F0m/F0n add the pages behind these paths; until then they 404 in the router. */
export const MAIN_NAV: NavItem[] = [
  { label: 'Product', to: '/product' },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Compute lanes', to: '/compute-lanes' },
  { label: 'Verification', to: '/verification' },
  { label: 'Architecture', to: '/architecture' },
  { label: 'Developers', to: '/developers' },
];

export const FOOTER_NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Network',
    items: [
      { label: 'Product', to: '/product' },
      { label: 'Compute lanes', to: '/compute-lanes' },
      { label: 'Verification', to: '/verification' },
      { label: 'Architecture', to: '/architecture' },
    ],
  },
  {
    title: 'Learn',
    items: [
      { label: 'Solutions', to: '/solutions' },
      { label: 'Developers', to: '/developers' },
      { label: 'Changelog', to: '/changelog' },
      { label: 'Blog', to: '/blogs' },
      { label: 'Case studies', to: '/case-study' },
    ],
  },
  {
    title: 'Company',
    items: [
      { label: 'About', to: '/about' },
      { label: 'Community', to: '/community' },
    ],
  },
  {
    title: 'Legal',
    items: [
      { label: 'Privacy policy', to: '/privacy-policy' },
      { label: 'Cookie policy', to: '/cookie-policy' },
      { label: 'Terms', to: '/terms-conditions' },
    ],
  },
];
