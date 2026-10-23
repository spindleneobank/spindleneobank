import type { Cta, Feature, PageMeta, Step } from '../../components/marketing/types';
import { CTA_API, CTA_DASHBOARD } from './home';

export const productMeta: PageMeta = {
  title: 'Product: compute, receipts, claims | Spindle',
  description:
    'One network for compute, receipts and payout choice. Jobs leave signed receipts, verified earnings accrue in USDG, and you claim to your wallet before funding a card or swapping.',
  path: '/product',
};

export const productHero = {
  eyebrow: 'Product',
  title: 'One network for compute, receipts and payout choice',
  lead: 'Spindle connects GPU providers with AI workloads. Jobs leave signed receipts, verified earnings accrue in USDG, and providers claim to their own wallet, then choose what to do next.',
  ctas: [CTA_DASHBOARD, CTA_API] as Cta[],
};

export const youGet = {
  eyebrow: 'What you get',
  title: 'The steps from GPU to payout, with the choice left to you.',
  items: [
    {
      icon: 'receipts',
      title: 'Clear work records',
      body: 'Each completed job carries a signed receipt, with metering checked before it reaches the ledger.',
    },
    {
      icon: 'lanes',
      title: 'Defined compute lanes',
      body: 'Open jobs are non-sensitive workloads served from registered nodes. The sealed lane needs eligible confidential GPUs and attestation, and is in testing.',
    },
    {
      icon: 'wallet',
      title: 'You stay in control',
      body: 'Claims go to your wallet. Funding a card or swapping to a Stock Token are separate steps that show the quote and conditions before you sign.',
    },
  ] satisfies Feature[],
};

export const networkDiagram = {
  eyebrow: 'Network diagram',
  title: 'How the pieces connect',
  nodes: [
    { id: 'api', icon: 'api', label: 'API gateway', note: 'OpenAI-compatible' },
    { id: 'sched', icon: 'scheduler', label: 'Scheduler', note: 'lane, VRAM, stake, reputation' },
    { id: 'node', icon: 'nodes', label: 'Registered node', note: 'Docker agent, GPU' },
    { id: 'receipt', icon: 'receipts', label: 'Signed receipt', note: 'COSE per job' },
    { id: 'epoch', icon: 'merkle', label: 'Hourly root', note: 'on Robinhood Chain' },
    { id: 'claim', icon: 'wallet', label: 'Wallet claim', note: 'USDG, after 1h delay' },
  ],
  after: [
    { icon: 'cards', label: 'Fund a virtual card' },
    { icon: 'stock', label: 'Swap to a Stock Token' },
  ],
};

export const capabilities = {
  eyebrow: 'Capabilities',
  title: 'Everything between the AI request and the provider claim',
  items: [
    {
      icon: 'receipts',
      title: 'Work recorded in signed receipts',
      body: 'The node signs a COSE receipt for each job. Verification checks its signature, job billing and measured units before the work enters the USDG earnings ledger.',
    },
    {
      icon: 'overview',
      title: 'Follow nodes, receipts and claims',
      body: 'The dashboard brings node state, compute lane, receipt epochs and claims into one view. Preview records on this site illustrate the flow; they are not live network metrics.',
    },
    {
      icon: 'api',
      title: 'A familiar interface for AI builders',
      body: 'Chat completions, embeddings and images, with a compute-lane header.',
    },
  ] satisfies Feature[],
};

export const flow = {
  eyebrow: 'Compute to card or stock',
  title: 'A defined path from job to claim',
  lead: 'Verified receipts feed the earnings ledger. An hourly root records cumulative entitlement. After the 1h claim delay you sign a claim to your wallet, then choose to fund a card or swap.',
  steps: [
    { title: 'Compute', body: 'A registered node serves a job.', icon: 'gpu' },
    { title: 'Receipt', body: 'The node signs a COSE receipt; metering is verified.', icon: 'receipts' },
    { title: 'Epoch root', body: 'Verified work enters the next hourly Merkle root.', icon: 'merkle' },
    { title: 'Claim', body: 'Claim USDG to your wallet. You pay gas.', icon: 'wallet' },
    {
      title: 'Card or stock',
      body: 'Fund a virtual card in one flow, or swap into a curated Stock Token with a quote first.',
      icon: 'cards',
    },
  ] satisfies Step[],
};

export const onboarding = {
  eyebrow: 'How it works',
  title: 'From install to claim',
  steps: [
    {
      title: 'Register your node',
      body: 'Install the Docker node agent. Benchmark the GPU, detect its capabilities and register the node from your wallet. Nodes must register to receive work.',
    },
    {
      title: 'Stake if you want priority',
      body: 'Staking is optional. It puts a node in a routing priority tier once it meets the per-class minimum.',
    },
    {
      title: 'Claim, then choose',
      body: 'Claim USDG to your wallet, then fund a virtual card or quote a Stock Token swap.',
    },
  ] satisfies Step[],
};
