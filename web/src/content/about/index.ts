/**
 * About / network-role copy. Verbatim from the old rendered pages (parity task P6); the only deviations are the
 * rows approved in docs/plan/parity-text-exceptions.md (claims always land in the wallet first).
 */
export type Role = {
  slug: string;
  name: string;
  /** Hero chips on the role page: category first, then the design name. */
  chips: [string, string];
  /** Row on the network-role list: `design / state` then the category. */
  list: { design: string; state: string; category: string };
  about: string;
  flow: string[];
  considerations: string[];
};

export const ROLES: Role[] = [
  {
    slug: 'api-developer',
    name: 'API developer',
    chips: ['Developer tools', 'API design'],
    list: { design: 'API design', state: 'Preview', category: 'Developer tools' },
    about:
      'The API developer builds applications on the gateway design. OpenAI-compatible chat, embedding and image endpoints connect a request to suitable compute and its signed receipt. This page describes the integration role, not an employment opening.',
    flow: [
      // approved exception (/about/senior-full-stack-engineer): sealed lane is not live
      'Choose the open compute lane for a request',
      'Call chat, embedding or image endpoints',
      'Use a USDG balance or per-call x402 payment design',
      'Retrieve the signed receipt for a completed job',
    ],
    considerations: [
      'Sealed requests need the eligible confidential stack (in testing)',
      'Open-lane prompts are visible to the operator',
      'Receipts evidence execution, not output correctness',
      'Production access and launch details are coming soon',
    ],
  },
  {
    slug: 'node-operator',
    name: 'Node operator',
    chips: ['Developer tools', 'Node design'],
    list: { design: 'Node design', state: 'Specification', category: 'Developer tools' },
    about:
      'The node operator maintains the node that serves suitable AI work. The specification combines GPU benchmarking, bonded identity, stake and reputation with signed receipts and lane-aware job routing. This page describes that network role, not an employment opening.',
    flow: [
      'Register the node key and detected GPU capabilities',
      'Inspect node state, lane and attestation status',
      'Sign a COSE receipt when each AI job completes',
      'Follow verified work into hourly receipt epochs',
    ],
    considerations: [
      'Open-lane work must be non-sensitive',
      'Sealed-lane nodes require eligible confidential GPUs (in testing)',
      'Attestation and canaries support verification',
      'Earnings depend on completed buyer-funded work',
    ],
  },
  {
    slug: 'gpu-provider',
    name: 'GPU provider',
    chips: ['GPU classes', 'Compute supply'],
    list: { design: 'Compute supply', state: 'Preview', category: 'GPU classes' },
    about:
      'The GPU provider supplies compute for AI workloads suited to the GPU class and privacy lane. The node agent benchmarks hardware and registers its identity. This page describes a role in the proposed network, not an employment opening or an earnings offer.',
    flow: [
      'Install the Docker node agent on suitable hardware',
      'Benchmark GPU capability and available VRAM',
      'Serve work matched to the node’s compute lane',
      'Inspect USDG work records and intended payout steps',
    ],
    considerations: [
      'Consumer GPUs belong in the non-private open lane',
      'Eligible confidential GPUs may serve the sealed lane (in testing)',
      'Demand and the posted rate card determine earnings',
      'There is no promise of income or GPU utilization',
    ],
  },
  {
    slug: 'payout-explorer',
    name: 'Payout explorer',
    chips: ['Payout routes', 'Claim design'],
    list: { design: 'Claim design', state: 'Preview', category: 'Payout routes' },
    about:
      'The payout explorer follows a claim from verified USDG earnings to the route selected by its owner. This is a network role in the v1.1 design, not an employment opening. It covers quotes, claim signatures, delivery status and program conditions.',
    flow: [
      'Inspect the cumulative entitlement for a receipt epoch',
      // approved exception (/about/customer-engineer)
      'Claim to a wallet, then pick a Stock Token or card',
      'Review a Stock Token quote and price impact first',
      'Follow the intended claim status and delivery flow',
    ],
    considerations: [
      'Earnings accrue in USDG rather than the SPDL token',
      'Card regions, limits and terms belong to its program',
      'Stock Token availability depends on eligibility and liquidity',
      // approved exception (/about/customer-engineer)
      'A wallet claim and later steps share one cumulative entitlement',
    ],
  },
];

export const PRIMITIVES = [
  'Signed job receipts and USDG metering',
  'A shared ledger across payout routes',
  'Hourly cumulative Merkle roots',
  'A defined path from verified work to claim',
];

/** Idea paragraphs (two blocks). Second carries approved exceptions (/about, Network roles). */
export const ABOUT_IDEA = [
  'Spindle connects GPU supply to AI demand. Providers register a bonded node, serve suitable jobs and receive a signed record of the work.',
  'Verified earnings accrue in USDG. Hourly receipt roots support claims, while providers claim USDG, then choose a Stock Token or card. The design keeps compute lanes, evidence and payout choice visible.',
];

export const ABOUT_BUILD = [
  {
    n: 'M1',
    title: 'Node identity',
    body: 'The specification begins with bonded node identity, registry contracts and an open-lane agent.',
  },
  {
    n: 'M2',
    title: 'Receipt roots',
    body: 'Verified work enters an earnings ledger, with cumulative Merkle roots posted in hourly epochs.',
  },
  {
    n: 'M4',
    title: 'Payout routes',
    body: 'Claim USDG, then quote a Stock Token or fund a card with your wallet.',
  },
  {
    n: 'M6',
    title: 'Sealed compute',
    body: 'In testing: confidential GPUs add an attested sealed lane for encrypted prompts and responses.',
  },
];

export const ABOUT_VALUES = [
  {
    icon: 'receipts',
    title: 'Show the receipt',
    body: 'Every job emits a signed work record. Receipts support metering; they do not prove output correctness.',
  },
  {
    icon: 'sealed',
    title: 'Privacy has a defined lane',
    body: 'Confidential compute belongs in the sealed lane. Open-lane jobs must be non-sensitive.',
  },
  {
    icon: 'split',
    title: 'Keep payout choice clear',
    body: 'Earnings accrue in USDG. Providers claim to a wallet, then pick a Stock Token or card.',
  },
  {
    icon: 'limit',
    title: 'Make limits visible',
    body: 'Buyer demand, supported regions, card terms and Stock Token liquidity shape what is available.',
  },
];

/** Team cards (old "Core network roles" grid). */
export const ABOUT_TEAM = [
  {
    name: 'GPU providers',
    blurb: 'Supply eligible compute',
    image: 'role-gpu-cooling-v10',
    pixel: 'gpu',
    filter: 'ember',
  },
  {
    name: 'AI builders',
    blurb: 'Bring suitable workloads',
    image: 'role-ai-light-v10',
    pixel: 'code',
    filter: 'orchid',
  },
  {
    name: 'Node operators',
    blurb: 'Maintain node performance',
    image: 'role-node-switch-v10',
    pixel: 'nodes',
    filter: 'ember',
  },
  {
    name: 'Developers',
    blurb: 'Build with the API',
    image: 'role-api-connectors-v10',
    pixel: 'terminal',
    filter: 'orchid',
  },
] as const;

/** Old (template-era) slug -> new slug. */
export const OLD_ROLE_SLUGS: Record<string, string> = {
  'customer-engineer': 'payout-explorer',
  'data-platform-engineer': 'node-operator',
  'product-designer': 'gpu-provider',
  'senior-full-stack-engineer': 'api-developer',
};
