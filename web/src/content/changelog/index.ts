export type Release = {
  id: string;
  tag: string;
  date: string;
  title: string;
  summary: string;
  items: string[];
};

export const RELEASES: Release[] = [
  {
    id: 'claims',
    tag: 'Spec: Claims',
    date: 'Oct 10, 2026',
    title: 'Claims and payout',
    summary: 'Claim USDG to your wallet, then fund a card or swap.',
    items: [
      'USDG claim to the owner wallet with a Merkle proof',
      'Swap to a stock token from the curated stock list, with quote and price impact shown first',
      'Card funding from the wallet through izipay and a Relay route',
      'One cumulative claimed balance per owner',
    ],
  },
  {
    id: 'receipts',
    tag: 'Spec: Metering',
    date: 'Oct 10, 2026',
    title: 'Signed receipts',
    summary: 'Each job links its metering to a signed receipt.',
    items: [
      'Signed COSE receipt per completed job',
      'Signature and billing-match verification',
      'USDG metering for verified work, split 80/20 between provider and treasury',
      'Hourly cumulative Merkle roots with a guardian veto window',
      'Receipt proof retrievable by job ID',
    ],
  },
  {
    id: 'nodes',
    tag: 'Spec: Node registry',
    date: 'Oct 10, 2026',
    title: 'Node and lane design',
    summary: 'Match suitable workloads to open or sealed GPUs.',
    items: [
      'Docker node agent and GPU benchmark',
      'Confidential-compute capability detection',
      'Wallet registration of the node key (required before serving)',
      'ERC-8004 node identity',
      'Optional staking for a routing priority tier',
    ],
  },
  {
    id: 'sealed',
    tag: 'Spec: Sealed lane',
    date: 'Oct 10, 2026',
    title: 'Sealed lane (in testing)',
    summary: 'Attested confidential execution for private jobs.',
    items: [
      'Eligible TDX confidential GPU stack',
      'OHTTP relay for sealed requests',
      'GPU evidence and model measurement checks',
      'Fresh attestation required by the design',
      'Open lane restricted to non-sensitive work',
    ],
  },
];
