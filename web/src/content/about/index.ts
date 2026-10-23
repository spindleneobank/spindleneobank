export type Role = {
  slug: string;
  name: string;
  tag: string;
  image: string;
  summary: string;
  about: string;
  flow: string[];
  considerations: string[];
  to: string;
  eyebrow: string;
};

export const ROLES: Role[] = [
  {
    slug: 'api-developer',
    name: 'API developer',
    tag: 'API design',
    eyebrow: 'Developer tools',
    image: '/assets/stock/role-api-connectors-v10.webp',
    summary: 'Build with the API',
    to: '/developers',
    about:
      'The API developer builds applications on the gateway. OpenAI-compatible chat, embedding and image endpoints connect a request to suitable compute and its signed receipt. This page describes the integration role, not an employment opening.',
    flow: [
      'Choose the open lane for a request (the sealed lane is in testing)',
      'Call chat, embedding or image endpoints',
      'Pay from a USDG API balance or per call with x402, which adds a small surcharge',
      'Retrieve the signed receipt for a completed job',
    ],
    considerations: [
      'Sealed requests need the eligible confidential stack and are in testing',
      'Open-lane prompts are visible to the node operator',
      'Receipts evidence execution, not output correctness',
      'Production access and launch details are coming soon',
    ],
  },
  {
    slug: 'node-operator',
    name: 'Node operator',
    tag: 'Node design',
    eyebrow: 'Node operations',
    image: '/assets/stock/role-node-switch-v10.webp',
    summary: 'Manage verified work',
    to: '/compute-lanes',
    about:
      'The node operator maintains the node that serves suitable AI work. A node must register on-chain from an owner wallet before it can serve. Staking is optional and puts the node in a priority tier for routing. This page describes that network role, not an employment opening.',
    flow: [
      'Install the Docker node agent and register the node key and detected GPU capabilities from your wallet',
      'Inspect node state, lane and attestation status',
      'Sign a COSE receipt when each AI job completes',
      'Follow verified work into hourly receipt epochs',
    ],
    considerations: [
      'Open-lane work must be non-sensitive',
      'Sealed-lane nodes require eligible confidential GPUs and are in testing',
      'Attestation and canary jobs support verification',
      'Earnings depend on completed buyer-funded work',
    ],
  },
  {
    slug: 'gpu-provider',
    name: 'GPU provider',
    tag: 'Compute supply',
    eyebrow: 'Compute supply',
    image: '/assets/stock/role-gpu-cooling-v10.webp',
    summary: 'Supply eligible compute',
    to: '/compute-lanes',
    about:
      'The GPU provider supplies compute for AI workloads suited to the GPU class and privacy lane. The node agent benchmarks hardware, then the node registers from the provider wallet. This page describes a role in the network, not an employment opening or an earnings offer.',
    flow: [
      'Install the Docker node agent on suitable hardware',
      'Benchmark GPU capability and available VRAM',
      'Register the node, then serve work matched to its compute lane',
      'Inspect USDG work records and claim them to your wallet',
    ],
    considerations: [
      'Consumer GPUs belong in the non-private open lane',
      'Eligible confidential GPUs may serve the sealed lane once it leaves testing',
      'Demand and the posted rate card determine earnings',
      'There is no promise of income or GPU utilization',
    ],
  },
  {
    slug: 'payout-explorer',
    name: 'Payout explorer',
    tag: 'Claim design',
    eyebrow: 'Payout routes',
    image: '/assets/stock/receipt-connectors-v10.webp',
    summary: 'Follow a claim to your wallet',
    to: '/architecture/claim-service',
    about:
      'The payout explorer follows a claim from verified USDG earnings to the owner wallet. From the wallet the owner can fund a card or swap to a stock token from the curated list. This page describes a network role, not an employment opening, and covers claim proofs and delivery status.',
    flow: [
      'Inspect the cumulative entitlement for a receipt epoch',
      'Claim USDG to your wallet with the Merkle proof',
      'Fund a card from the wallet, or swap USDG to a stock token',
      'Review any swap quote and price impact before signing',
    ],
    considerations: [
      'Earnings accrue in USDG rather than the SPDL token',
      'Card regions, limits and terms belong to the card program',
      'Stock token availability depends on the curated list and liquidity',
      'A claim always pays the wallet; later steps are separate wallet transactions',
    ],
  },
];

export const PRIMITIVES = [
  'Signed job receipts and USDG metering',
  'A shared ledger behind every claim',
  'Hourly cumulative Merkle roots',
  'A defined path from verified work to your wallet',
];

export const ABOUT_BUILD = [
  {
    n: 'M1',
    title: 'Node identity',
    body: 'Nodes register on-chain from an owner wallet, with registry contracts and an open-lane agent. Staking is optional and sets a routing priority tier.',
  },
  {
    n: 'M2',
    title: 'Receipt roots',
    body: 'Verified work enters an earnings ledger, with cumulative Merkle roots posted in hourly epochs.',
  },
  {
    n: 'M4',
    title: 'Claims and payout',
    body: 'Claim USDG to your wallet. From there, fund a card or swap to a stock token from the curated list.',
  },
  {
    n: 'M6',
    title: 'Sealed compute',
    body: 'Eligible confidential GPUs add an attested sealed lane for encrypted prompts and responses. This lane is in testing.',
  },
];

export const ABOUT_VALUES = [
  {
    icon: 'receipt',
    title: 'Show the receipt',
    body: 'Every job emits a signed work record. Receipts support metering; they do not prove output correctness.',
  },
  {
    icon: 'lock',
    title: 'Privacy has a defined lane',
    body: 'Confidential compute belongs in the sealed lane, which is in testing. Open-lane jobs must be non-sensitive.',
  },
  {
    icon: 'routes',
    title: 'Keep payout clear',
    body: 'Earnings accrue in USDG and are claimed to your wallet. From there you can fund a card or swap to a stock token.',
  },
  {
    icon: 'limit',
    title: 'Make limits visible',
    body: 'Buyer demand, supported regions, card terms and stock token liquidity shape what is available.',
  },
];

/** Old (template-era) slug -> new slug. */
export const OLD_ROLE_SLUGS: Record<string, string> = {
  'customer-engineer': 'payout-explorer',
  'data-platform-engineer': 'node-operator',
  'product-designer': 'gpu-provider',
  'senior-full-stack-engineer': 'api-developer',
};
