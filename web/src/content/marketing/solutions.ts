import type { Cta, Feature, PageMeta } from '../../components/marketing/types';
import { CTA_API, CTA_DASHBOARD, CTA_NODE } from './home';

export const solutionsMeta: PageMeta = {
  title: 'Solutions by network role | Spindle',
  description:
    'Supply GPUs, build AI applications, operate nodes or explore the claim design. Each role shares a receipt-backed view of the work.',
  path: '/solutions',
};

export const solutionsHero = {
  eyebrow: 'Solutions by network role',
  title: 'Find your place in the compute flow',
  lead: 'Supply suitable GPUs, build AI applications, operate nodes or explore the claim design. Each role shares a receipt-backed view of the work.',
  ctas: [CTA_DASHBOARD, CTA_NODE] as Cta[],
  chips: ['Register a node', 'Serve suitable jobs', 'Verify signed work', 'Claim to your wallet'],
};

export type RoleBlock = {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  cta: Cta;
  image: string;
  alt: string;
};

export const roleBlocks: RoleBlock[] = [
  {
    id: 'gpu-providers',
    eyebrow: 'GPU providers',
    title: 'Put your GPU to work, with a clear payout path.',
    body: 'The node agent benchmarks a GPU, detects its capability and walks you through registering the node with a wallet transaction. Staking is optional and gives routing priority.',
    bullets: [
      'A registered node identity, linked to your wallet',
      'A compute lane matched to GPU capability',
      'Signed receipts for completed AI work',
    ],
    cta: CTA_NODE,
    image: '/assets/media/pink-lagoon-figure-brand-v8.webp',
    alt: 'A flower-headed figure in a pink lagoon',
  },
  {
    id: 'ai-builders',
    eyebrow: 'AI builders',
    title: 'Choose a compute lane for your AI request.',
    body: 'The compatible API routes work to the open lane. The sealed lane for private work is in testing. Open-lane work is visible to the node operator.',
    bullets: [
      'Chat, embeddings and image endpoints',
      'Sealed lane (in testing) uses eligible attested GPUs',
      'USDG balance or per-call x402 payment',
    ],
    cta: CTA_API,
    image: '/assets/media/pink-cloud-eye-brand-v8.webp',
    alt: 'An eye in pink clouds',
  },
  {
    id: 'node-operators',
    eyebrow: 'Node operators',
    title: 'Operate a node with evidence behind the work.',
    body: 'Inspect GPU capability, node identity, stake and reputation alongside signed job receipts and receipt epochs.',
    bullets: [
      'Node registration and optional stake from your wallet',
      'Metering checked against the gateway record',
      'Attestation checks for eligible sealed-lane nodes (in testing)',
    ],
    cta: CTA_DASHBOARD,
    image: '/assets/media/sunken-stone-giant-brand-v8.webp',
    alt: 'A stone giant in still water',
  },
  {
    id: 'developers',
    eyebrow: 'Developers',
    title: 'Build around an OpenAI-compatible API.',
    body: 'The gateway supports chat completions, embeddings and images, with job receipts retrievable by ID.',
    bullets: [
      'Choose sealed or open in the request header',
      'Retrieve the signed receipt for a completed job',
      'Use a USDG balance or a per-call payment flow',
    ],
    cta: CTA_API,
    image: '/assets/media/stone-retro-computer-brand-v8.webp',
    alt: 'A retro computer made of stone',
  },
  {
    id: 'claims',
    eyebrow: 'Claims',
    title: 'One earnings balance. Claim to your wallet, then choose.',
    body: 'Verified work accrues in USDG. Claims go to your wallet. Then you can fund a virtual card in one flow or swap into a Stock Token.',
    bullets: [
      'One shared entitlement per epoch root',
      'Stock quotes show price and impact first',
      'Card funding follows third-party program terms',
    ],
    cta: CTA_DASHBOARD,
    image: '/assets/media/skeleton-flower-field-brand-v8.webp',
    alt: 'A skeleton in a field of flowers',
  },
];

export const foundation = {
  eyebrow: 'The network underneath',
  title: 'A shared foundation behind every network role',
  items: [
    {
      icon: 'scheduler',
      title: 'Matches the compute lane',
      body: 'Route jobs by GPU capability, lane, VRAM fit, latency, stake and reputation.',
    },
    {
      icon: 'receipts',
      title: 'Every job receipted',
      body: 'A signed receipt links the node, job and metered work; hourly roots record cumulative entitlement.',
    },
    {
      icon: 'wallet',
      title: 'A claim you sign',
      body: 'You choose when to claim and what to do next. Stock swaps show price and impact before you sign.',
    },
  ] satisfies Feature[],
};
