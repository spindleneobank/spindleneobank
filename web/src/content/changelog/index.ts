/**
 * Build notes (/changelog). Copy is the old site's rendered text, verbatim (docs/plan/parity-1to1.md), except the
 * approved rows in docs/plan/parity-text-exceptions.md.
 */
export type Img = { src: string; alt: string; filter: 'ember' | 'orchid' | 'amber' | null };
export type Release = {
  title: string;
  tag: string;
  date: string;
  img: Img;
  heading: string;
  summary: string;
  items: string[];
};

export const CHANGELOG_HERO = {
  badge: 'Build note',
  title: 'Build notes',
  lead: 'Specification: October 10, 2026',
} as const;

export const RELEASES: Release[] = [
  {
    title: 'Receipt & claim design',
    tag: 'Spec: Claims',
    date: 'Oct 10, 2026',
    img: {
      src: '/assets/stock/notes-routing-v10.webp',
      alt: 'Macro microchip and circuitry for routing build notes',
      filter: 'ember',
    },
    heading: 'Payout routing',
    summary: 'Compare USDG, Stock Tokens and a virtual card.',
    items: [
      'USDG wallet claim route',
      'Canonical Stock Token quote flow',
      'Price and impact displayed before claim',
      'Virtual card adapter and delivery design',
      'Shared entitlement across split claims',
    ],
  },
  {
    title: 'Receipt & claim design',
    tag: 'Spec: Metering',
    date: 'v1.1 / Claims',
    img: {
      src: '/assets/stock/notes-privacy-v10.webp',
      alt: 'Diffused light through glass for sealed-lane privacy',
      filter: 'orchid',
    },
    heading: 'Signed receipts',
    summary: 'Each job links its metering to a signed receipt.',
    items: [
      'Signed COSE receipt per completed job',
      'Signature and billing-match verification',
      'USDG metering for verified work',
      'Hourly cumulative Merkle roots',
      'Receipt proof retrievable by job ID',
    ],
  },
  {
    title: 'Node & lane design',
    tag: 'Spec: Node registry',
    date: 'v1.1 / Receipts',
    img: {
      src: '/assets/stock/notes-epoch-v10.webp',
      alt: 'Warm light layers representing receipt epochs',
      filter: 'amber',
    },
    heading: 'Compute lanes',
    summary: 'Match suitable workloads to sealed (in testing) or open GPUs.',
    items: [
      'Docker node agent and GPU benchmark',
      'Confidential-compute capability detection',
      'Wallet-signed node registration',
      'Bonded ERC-8004 node identity',
      'Stake and reputation in routing design',
    ],
  },
  {
    title: 'Node & lane design',
    tag: 'Spec: Sealed lane',
    date: 'v1.1 / Nodes',
    img: {
      src: '/assets/stock/notes-node-v10.webp',
      alt: 'Illuminated computer cooling system for node operation notes',
      filter: 'orchid',
    },
    heading: 'Bonded identity',
    summary: 'Node identity, stake and reputation guide routing.',
    items: [
      'Eligible TDX confidential GPU stack',
      'OHTTP relay for sealed requests',
      'GPU evidence and model measurement checks',
      'Fresh attestation required by the design',
      'Open lane restricted to non-sensitive work',
    ],
  },
];
