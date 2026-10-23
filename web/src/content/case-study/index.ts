/**
 * Illustrative flows (/case-study). Copy is the old site's rendered text, verbatim (docs/plan/parity-1to1.md), except
 * the approved rows in docs/plan/parity-text-exceptions.md.
 */
import type { Block } from '../blogs';

export type Flow = {
  slug: string;
  oldSlug: string;
  cardImg: { src: string; alt: string; filter: string | null };
  cardLogo: { src: string; alt: string };
  cardTitle: string;
  title: string;
  hero: { src: string; alt: string; filter: string | null };
  logo: { src: string; alt: string; fit: 'contain' | 'cover'; w: number };
  stats: string;
  body: Block[];
  aside: { label: string; value: string }[];
  facts: { strong: string; text: string }[];
};

export const CASE_HERO = {
  badge: 'Illustrative flows',
  title: 'A closer look at the intended network flows',
  lead: 'Illustrative flows based on the v1.1 specification. These explain the architecture and payout choices; they are not customer results or live deployments.',
  statsHeading: 'From completed job to a signed receipt.',
  stats: 'Verified work flow',
  heading: 'All illustrative flows',
  cta: 'Explore flow',
} as const;
export const CASE_HERO_IMG = {
  src: '/assets/stock/wood-spiral-web-v10.webp',
  alt: 'Brown Spiral Staircase Abstraction',
  filter: 'amber',
};
export const CASE_HERO_BADGE = { src: '/assets/pixel/badge-spindle-network.svg', alt: '' };
export const CASE_LOGOS: { src: string; alt: string }[] = [
  { src: '/assets/slots/0tQJ7SlKdpCZUVbUjxOEy57XRhA.svg', alt: 'Spindle architecture mark' },
  { src: '/assets/slots/hsbt5NG4UUe3LO7ERSFGv8A0PrA.svg', alt: 'Spindle architecture mark' },
  { src: '/assets/slots/O7fimt1JVKhKUjjZOGgeAWTdLQ.svg', alt: 'Spindle architecture mark' },
  { src: '/assets/slots/yg73mxfKVqYxGdl9PXd5goIE.svg', alt: 'Spindle architecture mark' },
  { src: '/assets/slots/6Fbv7vEmmB0WPOWiVDEZNhoZ0.svg', alt: 'Spindle architecture mark' },
  { src: '/assets/slots/hsbt5NG4UUe3LO7ERSFGv8A0PrA.svg', alt: 'Spindle architecture mark' },
];

export const FLOWS: Flow[] = [
  {
    slug: 'provider-registration',
    oldSlug: 'globaltech-automates-it-helpdesk-operations-freeing-up-3-000-annual-hours',
    cardImg: {
      src: '/assets/stock/stone-helix-web-v10.webp',
      alt: 'Stone Spiral Staircase in Dramatic Light',
      filter: 'amber',
    },
    cardLogo: {
      src: '/assets/pixel/badge-gpu-providers.svg',
      alt: '',
    },
    cardTitle: 'A GPU Provider’s Path from Node Registration to Signed Work Receipts',
    title: 'A GPU Provider’s Path from Node Registration to Signed Work Receipts',
    hero: {
      src: '/assets/stock/iridescent-sculpture-web-v10.webp',
      alt: 'Iridescent Abstract Glass Sculpture',
      filter: 'ember',
    },
    logo: {
      src: '/assets/pixel/badge-gpu-providers.svg',
      alt: '',
      fit: 'contain',
      w: 173,
    },
    stats: 'One path from GPU to receipt',
    body: [
      {
        t: 'h4',
        text: 'The starting point',
      },
      {
        t: 'p',
        text: 'Illustrative flow: a GPU provider wants to supply suitable compute and understand how a completed AI job becomes a work record. The provider needs a benchmarked GPU, a node identity and a clear distinction between confidential hardware and the open lane. Available hardware does not itself guarantee demand or earnings.',
      },
      {
        t: 'img',
        src: '/assets/stock/blue-glass-curves-web-v10.webp',
        alt: 'Abstract Blue Glass Curves',
        filter: 'amber',
      },
      {
        t: 'h4',
        text: 'The intended flow',
      },
      {
        t: 'p',
        text: 'The provider installs the Docker node agent. It benchmarks GPU capability, creates a node key and registers through a wallet signature. The scheduler matches suitable jobs by lane, VRAM fit, latency, stake and reputation. Completed jobs produce signed receipts; verified work accrues in USDG and enters the next cumulative receipt epoch.',
      },
      {
        t: 'h4',
        text: 'Design outcome',
      },
      {
        t: 'p',
        text: 'The intended outcome is one view from node registration through job verification and hourly receipt roots. There are two compute lanes in the design and USDG is the unit of earnings. This is a specification walkthrough, with no live node count, utilization promise or projected income.',
      },
    ],
    aside: [
      {
        label: 'Network role',
        value: 'GPU providers',
      },
      {
        label: 'Focus',
        value: 'Compute supply',
      },
      {
        label: 'Design stage',
        value: 'v1.1 specification',
      },
      {
        label: 'Context',
        value: 'Illustrative flow',
      },
    ],
    facts: [
      {
        strong: '02',
        text: 'compute lanes in the design',
      },
      {
        strong: 'USDG',
        text: 'unit of earnings',
      },
      {
        strong: '01h',
        text: 'hourly receipt roots',
      },
    ],
  },
  {
    slug: 'payout-routes',
    oldSlug: 'shopflow-scales-customer-support-10x-without-increasing-headcount-or-costs',
    cardImg: {
      src: '/assets/stock/spiral-lightwell-web-v10.webp',
      alt: 'Spiral Staircase Descent',
      filter: 'ember',
    },
    cardLogo: {
      src: '/assets/slots/GUZy1dO4RlAYlvm1ZIjM84DSQ.svg',
      alt: 'ShopFlow logo',
    },
    cardTitle: 'A Provider’s Choice of USDG, Stock Token or Virtual Card After Claiming',
    title: 'A Provider’s Choice of USDG, Stock Token or Virtual Card Claim Routes',
    hero: {
      src: '/assets/stock/translucent-ribbons-web-v10.webp',
      alt: 'Colorful Abstract CGI Artwork',
      filter: 'orchid',
    },
    logo: {
      src: '/assets/slots/GUZy1dO4RlAYlvm1ZIjM84DSQ.svg',
      alt: 'ShopFlow logo',
      fit: 'cover',
      w: 137,
    },
    stats: 'Choose how a claim is routed',
    body: [
      {
        t: 'h4',
        text: 'The starting point',
      },
      {
        t: 'p',
        text: 'Illustrative flow: a GPU provider has verified USDG earnings and wants to choose a payout destination. Selling a separate earnings token is not part of the proposed flow. The provider instead compares a direct USDG wallet claim, a canonical Stock Token claim and a virtual card claim, subject to route conditions.',
      },
      {
        t: 'img',
        src: '/assets/stock/marble-veins-web-v10.webp',
        alt: 'White Marble Texture',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'The intended flow',
      },
      {
        t: 'p',
        text: 'The claim service builds the selected route against the provider’s cumulative Merkle entitlement. The stock route checks the canonical registry and shows price impact before signing. The card step spends claimed USDG on-chain before issuance, tracks the request by claim ID and is designed to refund USDG after issuance failure. A split claim can combine routes.',
      },
      {
        t: 'h4',
        text: 'Design outcome',
      },
      {
        t: 'p',
        text: 'The design outcome is three intended payout routes sharing a single claimed balance. Card regions and program terms, as well as Stock Token eligibility and liquidity, shape availability. This is an illustrative specification flow, not a record of issued cards, completed customer payouts or financial returns.',
      },
    ],
    aside: [
      {
        label: 'Network role',
        value: 'Payout explorers',
      },
      {
        label: 'Focus',
        value: 'Payout routing',
      },
      {
        label: 'Design stage',
        value: 'v1.1 specification',
      },
      {
        label: 'Context',
        value: 'Illustrative flow',
      },
    ],
    facts: [
      {
        strong: '03',
        text: 'intended payout routes',
      },
      {
        strong: 'QUOTE',
        text: 'hourly receipt roots',
      },
      {
        strong: '0',
        text: 'quote before Stock Token claim',
      },
    ],
  },
  {
    slug: 'sealed-request',
    oldSlug: 'medicore-health-reduces-no-shows-by-60-using-smarter-scheduling',
    cardImg: {
      src: '/assets/stock/white-spiral-web-v10.webp',
      alt: 'White Spiral Staircase in Mexico City',
      filter: 'ember',
    },
    cardLogo: {
      src: '/assets/pixel/badge-ai-builders.svg',
      alt: '',
    },
    cardTitle: 'An AI Builder’s Request through the Attested Sealed Compute Lane',
    title: 'An AI Builder’s Request through the Attested Sealed Compute Lane',
    hero: {
      src: '/assets/stock/glass-swirl-web-v10.webp',
      alt: 'Abstract Glass Swirl Wallpaper',
      filter: 'orchid',
    },
    logo: {
      src: '/assets/pixel/badge-ai-builders.svg',
      alt: '',
      fit: 'contain',
      w: 115,
    },
    stats: 'A defined privacy boundary',
    body: [
      {
        t: 'h4',
        text: 'The starting point',
      },
      {
        t: 'p',
        text: 'Illustrative flow: an AI builder has a workload that requires a defined confidentiality boundary. Routing it to an ordinary consumer GPU would not make the prompts private from the operator. The sealed-lane design instead requires eligible confidential GPUs and a TDX environment with current attestation.',
      },
      {
        t: 'img',
        src: '/assets/stock/iridescent-vase-web-v10.webp',
        alt: 'Iridescent Glass Vase Close-Up',
        filter: 'orchid',
      },
      {
        t: 'h4',
        text: 'The intended flow',
      },
      {
        t: 'p',
        text: 'The builder will select the sealed lane in the API request. The OHTTP relay passes the encrypted body to the gateway and the eligible node decrypts it within the confidential environment. The completed job returns a response and a signed receipt linked to environment, model and GPU evidence. The design leaves the host operator with ciphertext.',
      },
      {
        t: 'h4',
        text: 'Design outcome',
      },
      {
        t: 'p',
        text: 'The intended outcome is private execution inside the defined sealed-lane boundary, with attested work records. This is an illustrative architecture flow rather than a customer deployment or a security audit. The open lane is not confidential, and the disclosed TEE limitations still apply.',
      },
    ],
    aside: [
      {
        label: 'Network role',
        value: 'AI builders',
      },
      {
        label: 'Focus',
        value: 'Sealed compute',
      },
      {
        label: 'Design stage',
        value: 'v1.1 specification',
      },
      {
        label: 'Context',
        value: 'Illustrative flow',
      },
    ],
    facts: [
      {
        strong: 'TDX',
        text: 'sealed-lane environment',
      },
      {
        strong: 'CC',
        text: 'eligible confidential GPUs',
      },
      {
        strong: 'OHTTP',
        text: 'relay for sealed requests',
      },
    ],
  },
  {
    slug: 'operator-identity',
    oldSlug: 'finedge-bank-cuts-fraud-detection-time-by-80-using-ai-automation',
    cardImg: {
      src: '/assets/stock/circular-skylight-web-v10.webp',
      alt: 'Spiral Staircase with Central Skylight',
      filter: 'ember',
    },
    cardLogo: {
      src: '/assets/pixel/badge-node-operators.svg',
      alt: '',
    },
    cardTitle: 'A Node Operator’s View of Bonded Identity and Verified Job Receipts',
    title: 'A Node Operator’s View of Bonded Identity and Verified Job Receipts',
    hero: {
      src: '/assets/stock/weathered-spiral-web-v10.webp',
      alt: 'Stone Spiral Staircase from Above',
      filter: 'orchid',
    },
    logo: {
      src: '/assets/pixel/badge-node-operators.svg',
      alt: '',
      fit: 'contain',
      w: 130,
    },
    stats: 'Signed work verification',
    body: [
      {
        t: 'h4',
        text: 'The starting point',
      },
      {
        t: 'p',
        text: 'Illustrative flow: a node operator needs to connect completed AI work to the node that served it, the units billed and the earnings recorded. A hardware label alone does not establish that work occurred. The Spindle specification uses bonded node identity and signed receipts as the common references for this path.',
      },
      {
        t: 'img',
        src: '/assets/stock/porto-spiral-web-v10.webp',
        alt: 'Circular Spiral Staircase in Porto',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'The intended flow',
      },
      {
        t: 'p',
        text: 'The node signs a COSE receipt for each job. A verifier checks its signature, the job-to-billing match and token counts against the gateway. Eligible sealed-lane nodes attach attestation evidence. Metering applies the rate card to verified work, then an epoch builder records cumulative entitlement in an hourly Merkle root on Robinhood Chain.',
      },
      {
        t: 'h4',
        text: 'Design outcome',
      },
      {
        t: 'p',
        text: 'The design outcome is a traceable path from node identity to signed work and an hourly receipt epoch. This is an explanation of the v1.1 architecture, not a deployed customer result. A receipt evidences execution on the measured stack; it does not prove the output was correct.',
      },
    ],
    aside: [
      {
        label: 'Network role',
        value: 'Node operators',
      },
      {
        label: 'Focus',
        value: 'Node verification',
      },
      {
        label: 'Design stage',
        value: 'v1.1 specification',
      },
      {
        label: 'Context',
        value: 'Illustrative flow',
      },
    ],
    facts: [
      {
        strong: 'COSE',
        text: 'signed work receipts',
      },
      {
        strong: '01h',
        text: 'cumulative receipt epochs',
      },
      {
        strong: 'RHC',
        text: 'settlement and receipt roots',
      },
    ],
  },
];

export const FLOW_BY_OLD_SLUG: Record<string, Flow> = Object.fromEntries(FLOWS.map((f) => [f.oldSlug, f]));
