/** Header / footer content, verbatim from the old site's rendered DOM (hrefs mapped to the new routes). */
export type SubItem = { title: string; desc: string; to: string };
export const SOLUTIONS: SubItem[] = [
  { title: 'GPU providers', desc: 'Put compute to work', to: '/solutions#gpu-providers' },
  { title: 'AI builders', desc: 'Choose your compute lane', to: '/solutions#ai-builders' },
  { title: 'Node operators', desc: 'Manage verified work', to: '/solutions#node-operators' },
  { title: 'Developers', desc: 'Build with the API', to: '/developers' },
  { title: 'Payout choice', desc: 'USDG, stocks or a card', to: '/solutions#claims' },
];
export const COMPANY_A: SubItem[] = [
  { title: 'About', desc: 'The compute and payout design', to: '/about' },
  { title: 'Field notes', desc: 'Compute insights', to: '/blogs' },
  { title: 'Network roles', desc: 'Explore the architecture', to: '/about#career' },
  { title: 'Verification', desc: 'Receipts and attestation', to: '/verification' },
];
export const COMPANY_B: SubItem[] = [
  { title: 'Build notes', desc: 'Architecture updates', to: '/changelog' },
  { title: 'Community', desc: 'Telegram and X', to: '/community' },
  { title: 'Terms & Conditions', desc: 'Preview and design limits', to: '/terms-conditions' },
  { title: 'Privacy Policy', desc: 'Data-flow design', to: '/privacy-policy' },
];
export const NAV_LINKS = { product: { label: 'Product', to: '/product' }, flows: { label: 'Network flows', to: '/case-study' }, compute: { label: 'Compute', to: '/compute-lanes' } };
export const CTA_LABEL = 'Open the app'; // approved exception for "Open account"
export const FOOTER_COLS: { title: string; items: { label: string; to: string }[] }[] = [
  { title: 'Explore', items: [{ label: 'Product', to: '/product' }, { label: 'Solutions', to: '/solutions' }, { label: 'About', to: '/about' }, { label: 'Compute', to: '/compute-lanes' }, { label: 'Network flows', to: '/case-study' }, { label: 'Verification', to: '/verification' }] },
  { title: 'Resources', items: [{ label: 'Field notes', to: '/blogs' }, { label: 'Network roles', to: '/about#teams' }, { label: 'Network roles', to: '/about#career' }, { label: 'Architecture', to: '/architecture' }, { label: 'Build notes', to: '/changelog' }, { label: 'FAQ', to: '/#faq' }] },
  { title: 'More', items: [{ label: 'Privacy Policy', to: '/privacy-policy' }, { label: 'Terms & Conditions', to: '/terms-conditions' }, { label: 'Cookie Policy', to: '/cookie-policy' }, { label: 'Community', to: '/community' }, { label: '404', to: '/404' }] },
];
export const SOCIALS = [
  { key: 'github', label: 'GitHub', name: 'GitHub' },
  { key: 'telegram', label: 'Telegram', name: 'Telegram' },
  { key: 'x', label: 'X', name: 'X' },
] as const;
