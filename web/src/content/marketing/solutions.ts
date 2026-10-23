import type { PageMeta } from '../../components/marketing/types';

/**
 * /solutions copy, verbatim from the rendered old page (after copy.js / spindle.js ran). The only differences are the
 * rows listed for /solutions (and "*") in docs/plan/parity-text-exceptions.md, marked `exception` below.
 */
export const solutionsMeta: PageMeta = {
  title: 'Solutions by network role | Spindle',
  description:
    'Supply GPUs, build AI applications, operate nodes or explore the claim design. Each role shares a receipt-backed view of the work.',
  path: '/solutions',
};

export type Photo = {
  name: string;
  alt: string;
  width: number;
  height: number;
  mobileW: number;
  stockW: number;
};
const PHOTOS: Record<string, Omit<Photo, 'name'>> = {
  'network-core': {
    alt: 'Close view of compute circuitry and its connections',
    width: 2312,
    height: 2504,
    mobileW: 800,
    stockW: 1600,
  },
  'work-circuits': {
    alt: 'Detailed circuit assembly for metered GPU work',
    width: 740,
    height: 800,
    mobileW: 533,
    stockW: 1067,
  },
  'receipt-connectors': {
    alt: 'Electronic connectors and traces representing verifiable work',
    width: 740,
    height: 800,
    mobileW: 800,
    stockW: 1600,
  },
  'node-components': {
    alt: 'Precision electronic components for bonded node identity',
    width: 1480,
    height: 1600,
    mobileW: 600,
    stockW: 1200,
  },
  'compute-cooling': {
    alt: 'Paired metal cooling towers for sustained GPU work',
    width: 1218,
    height: 948,
    mobileW: 800,
    stockW: 1600,
  },
  'compute-microprocessor': {
    alt: 'Macro semiconductor circuitry for eligible compute lanes',
    width: 2436,
    height: 1896,
    mobileW: 800,
    stockW: 1600,
  },
  'node-board': {
    alt: 'Light through fiber-optic paths for node network connectivity',
    width: 2436,
    height: 1896,
    mobileW: 800,
    stockW: 1600,
  },
  'developer-traces': {
    alt: 'Intricate printed circuit paths for the compatible API',
    width: 2436,
    height: 1896,
    mobileW: 800,
    stockW: 1600,
  },
  'claim-refraction': {
    alt: 'Iridescent facets representing distinct payout routes',
    width: 2436,
    height: 1896,
    mobileW: 800,
    stockW: 1600,
  },
};
/** Old page images, same alt text. Only work-circuits carried the srcset that phones actually used (measured: the others load the stock file). */
function photo(name: string): Photo {
  return { name, ...(PHOTOS[name] as Omit<Photo, 'name'>) };
}

export const solutionsHero = {
  eyebrow: 'Solutions by network role',
  title: 'Find your place in the compute flow',
  lead: 'Supply suitable GPUs, build AI applications, operate nodes or explore the payout design. Each role shares a receipt-backed view of the work.',
  explore: { label: 'Explore app', to: '/dashboard/overview' },
  image: photo('network-core'),
  chips: ['Register a node', 'Serve suitable jobs', 'Verify signed work', 'Choose a payout route'],
};

export type Palette = 'orchid' | 'ember' | 'amber';

type CardBase = { image: Photo; palette: Palette; title: string; body: string };
export type FoundationCard =
  | (CardBase & { kind: 'lanes'; tags: [string, string][] })
  | (CardBase & { kind: 'receipt'; figure: string; note: string })
  | (CardBase & { kind: 'claim'; note: string; status: string });

export const foundation: { eyebrow: string; title: string; cards: FoundationCard[] } = {
  eyebrow: 'The network underneath',
  title: 'A shared foundation behind every network role',
  cards: [
    {
      kind: 'lanes',
      image: photo('work-circuits'),
      palette: 'ember',
      tags: [
        ['COSE', 'JOB'],
        ['ROOT', '01h'],
        ['TDX', 'CC'],
        ['USDG', 'RHC'],
      ],
      title: 'Matches the compute lane',
      body: 'Route jobs by GPU capability, lane, VRAM fit, latency, stake and reputation.',
    },
    {
      kind: 'receipt',
      image: photo('receipt-connectors'),
      palette: 'amber',
      figure: '02',
      note: 'Receipt · hourly epoch',
      title: 'Every job receipted',
      body: 'A signed receipt links the node, job and metered work; hourly roots record cumulative entitlement.',
    },
    {
      kind: 'claim',
      image: photo('node-components'),
      palette: 'orchid',
      note: 'Ready for a claim route',
      status: 'Preview',
      title: 'A visible claim choice',
      body: 'The provider chooses the route and signs. Stock claims show price and impact before execution.',
    },
  ],
};

export type Role = {
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
  bullets: string[];
  image: Photo;
  palette: Palette;
  caption: string;
  /** Image first in the DOM (old page alternates sides). */
  flip: boolean;
  /** Old bottom padding: 114 on sections 1/3/5, 140 on 2/4 (desktop only; 80 tablet, 60 phone). */
  tall: boolean;
};

export const roles: Role[] = [
  {
    id: 'gpu-providers',
    eyebrow: 'GPU providers',
    title: 'Put your GPU to work, with a clear payout path.',
    lead: 'The node agent benchmarks a GPU, detects confidential-compute capability and registers its node identity.',
    bullets: [
      'A node key linked to its bonded identity',
      'A compute lane matched to GPU capability',
      'Signed receipts for completed AI work',
    ],
    image: photo('compute-cooling'),
    palette: 'orchid',
    caption: 'Show the route from GPU to a signed receipt...',
    flip: false,
    tall: false,
  },
  {
    id: 'ai-builders',
    eyebrow: 'AI builders',
    title: 'Choose a compute lane for your AI request.',
    lead: 'The compatible API routes private work to the sealed lane and non-sensitive work to the open lane.',
    bullets: [
      'Chat, embeddings and image endpoints in the API design',
      'Sealed-lane requests use eligible attested GPUs',
      'USDG balance or per-call x402 payment design',
    ],
    image: photo('compute-microprocessor'),
    palette: 'ember',
    caption: 'Choose the right lane for this AI workload...',
    flip: true,
    tall: true,
  },
  {
    id: 'node-operators',
    eyebrow: 'Node operators',
    title: 'Operate a node with evidence behind the work.',
    lead: 'Inspect GPU capability, node identity, stake and reputation alongside signed job receipts and receipt epochs.',
    bullets: [
      'Node registration with a wallet signature', // exception: old "…with a passkey smart account"
      'Metering checked against the gateway record',
      'Attestation checks for eligible sealed-lane nodes',
    ],
    image: photo('node-board'),
    palette: 'orchid',
    caption: 'Inspect the node identity and receipt proof...',
    flip: false,
    tall: false,
  },
  {
    id: 'developers',
    eyebrow: 'Developers',
    title: 'Build around an OpenAI-compatible API.',
    lead: 'The gateway design supports chat completions, embeddings and images, with job receipts retrievable by ID.',
    bullets: [
      'Choose the open lane in the request header', // exception: old "Choose sealed or open in the request header"
      'Retrieve the signed receipt for a completed job',
      'Use a USDG balance or per-call payment flow',
    ],
    image: photo('developer-traces'),
    palette: 'amber',
    caption: 'Send a request through the compatible API...',
    flip: true,
    tall: true,
  },
  {
    id: 'claims',
    eyebrow: 'Payout choice',
    title: 'One earnings balance. Different payout paths.',
    // exception: old "Route a claim to a wallet, a canonical Stock Token or a virtual card."
    lead: 'Verified work accrues in USDG. Claim to a wallet, then pick a Stock Token or a virtual card.',
    bullets: [
      'One shared entitlement across claim routes',
      'Stock quotes show price and impact first',
      'Card funding follows third-party program terms', // exception: old "Card claims follow …"
    ],
    image: photo('claim-refraction'),
    palette: 'ember',
    caption: 'Compare USDG, Stock Token and card funding...', // exception: old "…and card claims..."
    flip: false,
    tall: false,
  },
];
