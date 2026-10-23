import type { FAQItem } from '../../components/FAQ';
import type { Cta, Feature, PageMeta, Step } from '../../components/marketing/types';

export const CTA_DASHBOARD: Cta = { label: 'Open dashboard', to: '/dashboard/overview' };
export const CTA_NODE: Cta = { label: 'Run a node', to: '/dashboard/compute', variant: 'secondary' };
export const CTA_API: Cta = { label: 'Use the API', to: '/developers', variant: 'secondary' };

export const homeMeta: PageMeta = {
  title: 'Spindle: a neobank for GPU work',
  description:
    'Spindle connects GPU supply to AI demand on Robinhood Chain. Nodes serve jobs, signed receipts record the work, and verified earnings are claimed in USDG to your wallet.',
  path: '/',
};

export const hero = {
  eyebrow: 'Compute meets payout choice',
  title: 'A neobank for GPU work.',
  subtitle: 'Earn in USDG. Choose how you get paid.',
  image: '/assets/graphics/dashboard-overview-v9.png',
  imageAlt: 'Illustrative Spindle dashboard with sample data: USDG balance, virtual card, recent activity',
  lead: 'Register a node, serve AI jobs, and claim verified earnings to your own wallet. From there, fund a virtual card or swap into a Stock Token.',
  ctas: [CTA_DASHBOARD, CTA_NODE],
};

export const capabilities = {
  eyebrow: 'Capabilities',
  title: 'Everything your team needs in one place.',
  lead: 'Four core capabilities, built to work together.',
  items: [
    {
      icon: 'receipts',
      title: 'Every completed job leaves a receipt.',
      body: 'Signed work records link your node, the job and its metering to an hourly receipt root.',
    },
    {
      icon: 'overview',
      title: 'One view from node to claim.',
      body: 'Node status, job receipts and claims in one place. Preview data shows the intended flow.',
    },
    {
      icon: 'routes',
      title: 'Claim to your wallet, then choose.',
      body: 'Claims land in your wallet in USDG. From there you can fund a virtual card or swap into a Stock Token, each as a separate step you sign.',
    },
    {
      icon: 'stack',
      title: 'A stack built around verifiable compute.',
      body: 'Docker nodes, an OpenAI-compatible API and on-chain receipts connect providers with AI demand.',
    },
  ] satisfies Feature[],
};

export const claimFlow = {
  eyebrow: 'Claim flow',
  title: 'From completed work to your chosen route.',
  lead: 'Signed receipts feed the ledger. Claim USDG to your wallet first, then fund a virtual card or quote a Stock Token swap.',
  nodes: [
    { label: 'Receipt', note: 'on job complete' },
    { label: 'Verify', note: 'hourly root, 1h claim delay' },
    { label: 'Claim to wallet', note: 'USDG, you pay gas' },
  ],
  branches: [
    { label: 'Fund a virtual card', note: 'separate step, you sign' },
    { label: 'Swap to a Stock Token', note: 'quote first, price impact shown' },
  ],
};

export type Role = {
  id: string;
  label: string;
  title: string;
  body: string;
  bullets: string[];
  cta: Cta;
  media: string;
  alt: string;
};

export const roles = {
  eyebrow: 'Use cases',
  title: 'Different roles. One compute network.',
  items: [
    {
      id: 'gpu',
      label: 'GPU providers',
      title: 'Put your GPU to work, with a clear payout path.',
      body: 'Install the node agent, benchmark the GPU, register the node with a wallet transaction and serve jobs suited to its compute lane. Staking is optional and gives routing priority.',
      bullets: [
        'Register the node on-chain before it can take work',
        'A compute lane matched to GPU capability',
        'Signed receipts for completed AI work',
      ],
      cta: CTA_NODE,
      media: 'skeleton-flower-field-brand-v8',
      alt: 'A skeleton in a suit standing in a field of flowers at dusk',
    },
    {
      id: 'builders',
      label: 'AI builders',
      title: 'Choose a compute lane for your AI request.',
      body: 'The compatible API routes work to the open lane today. The sealed lane is in testing and is not offered for production traffic yet.',
      bullets: [
        'Chat, embeddings and image endpoints',
        'Pick the lane with a request header',
        'USDG balance or per-call x402 payment',
      ],
      cta: CTA_API,
      media: 'pink-cloud-eye-brand-v8',
      alt: 'A large eye formed in pink clouds',
    },
    {
      id: 'operators',
      label: 'Node operators',
      title: 'Operate a node with evidence behind the work.',
      body: 'Inspect GPU capability, node identity, stake and reputation next to signed job receipts and receipt epochs.',
      bullets: [
        'Node registration and optional stake from your wallet',
        'Metering checked against the gateway record',
        'Attestation checks for eligible sealed-lane nodes (in testing)',
      ],
      cta: CTA_DASHBOARD,
      media: 'sunken-stone-giant-brand-v8',
      alt: 'A stone giant in still water',
    },
    {
      id: 'developers',
      label: 'Developers',
      title: 'Build around an OpenAI-compatible API.',
      body: 'The gateway supports chat completions, embeddings and images, with job receipts retrievable by ID.',
      bullets: [
        'Choose sealed or open in the request header',
        'Retrieve the signed receipt for a completed job',
        'Use a USDG balance or a per-call payment flow',
      ],
      cta: CTA_API,
      media: 'stone-retro-computer-brand-v8',
      alt: 'A retro computer made of stone',
    },
  ] satisfies Role[],
};

export const howItWorks = {
  eyebrow: 'How it works',
  title: 'Spindle connects GPU supply to AI demand, and shows the work behind it.',
  steps: [
    {
      icon: 'nodes',
      title: 'Register your node',
      body: 'Install the Docker node agent. Benchmark the GPU, detect its capabilities, then register the node from your wallet. Nodes must register to receive work.',
    },
    {
      icon: 'receipts',
      title: 'Complete a job, get a receipt',
      body: 'The node signs a COSE receipt. Verified work enters the earnings ledger and the next hourly Merkle root.',
    },
    {
      icon: 'wallet',
      title: 'Claim, then choose',
      body: 'Claim USDG to your wallet. Then fund a virtual card in one flow, or quote a Stock Token swap in your own wallet.',
    },
  ] satisfies Step[],
};

export const flows = {
  eyebrow: 'Illustrative flows',
  title: 'Explore the paths through the network',
  items: [
    {
      tag: 'Work to receipt',
      body: 'Install a node. Serve suitable AI jobs. Follow the signed receipt to a claim.',
      image: '/assets/stock/concrete-blocks-web-v10.webp',
      stat: { value: '2', label: 'compute lanes: open, and sealed (in testing)' },
    },
    {
      tag: 'Receipt to epoch',
      body: 'Verified work enters an hourly cumulative Merkle root posted on Robinhood Chain.',
      image: null,
      stat: null,
    },
    {
      tag: 'Epoch to wallet',
      body: 'After the 1h claim delay, prove your entitlement and claim USDG to your wallet.',
      image: null,
      stat: null,
    },
  ],
};

export const network = {
  eyebrow: 'Designed as a network',
  title: 'Run at any scale. Production-grade for your team and agents.',
  stats: [
    { value: '2', label: 'compute lanes: open, and sealed (in testing)' },
    { value: '3', label: 'steps from receipt to wallet' },
    { value: '1h', label: 'receipt epoch' },
    { value: '1', label: 'chain for settlement' },
  ],
};

export const evidence = {
  eyebrow: 'Security and verification',
  title: 'Evidence behind the work',
  lead: 'Signed job receipts, hourly Merkle roots, canary checks and a 1h claim delay with a guardian veto. Sealed-lane attestation is in testing.',
  items: [
    { icon: 'receipts', title: 'Signed job receipts' },
    { icon: 'merkle', title: 'Hourly Merkle roots' },
    { icon: 'shield', title: 'Claim delay and guardian veto' },
  ],
};

export const apiBlock = {
  eyebrow: 'MCP and API',
  title: 'Built for AI workloads with a familiar API',
  body: 'The API supports chat completions, embeddings and images. Select the open lane today; the sealed lane is in testing. Illustration below uses no live requests.',
  cta: { label: 'Use the API', to: '/developers' } satisfies Cta,
  ways: {
    eyebrow: 'One compatible API',
    title: 'Three ways to put compute to work.',
    items: [
      { title: 'Chat completions', body: 'Generate responses from suitable AI models.' },
      { title: 'Embeddings', body: 'Turn inputs into vectors for AI workloads.' },
      { title: 'Image generation', body: 'Route image workloads to eligible GPUs.' },
    ],
    note: 'Choose the open lane today; the sealed lane is in testing. Each completed job emits a signed receipt.',
  },
  image: '/assets/media/stone-retro-computer-brand-v8.webp',
  imageAlt: 'A stone retro computer overgrown with mushrooms in a dark garden',
};

export const specNotes = {
  eyebrow: 'Build notes',
  title: 'Inside the specification',
  items: [
    { tag: 'Claims', title: 'Wallet claims', body: 'Claim USDG to your wallet, then fund a card or swap.' },
    { tag: 'Receipts', title: 'Signed receipts', body: 'Each job links its metering to a signed receipt.' },
    {
      tag: 'Lanes',
      title: 'Compute lanes',
      body: 'Match suitable workloads to open GPUs; sealed is in testing.',
    },
    {
      tag: 'Nodes',
      title: 'Registered identity',
      body: 'Registration, optional stake and reputation guide routing.',
    },
  ],
};

export const faq = {
  title: 'Have questions? Find answers.',
  items: [
    {
      q: 'What does Spindle do?',
      a: 'Spindle is a GPU compute network on Robinhood Chain. Providers register GPU nodes and serve AI jobs. Each job emits a signed receipt and verified earnings accrue in USDG. You claim USDG to your own wallet, then optionally fund a virtual card or swap into a Stock Token. This site shows an illustrative dashboard; it does not display live earnings or guarantee demand.',
    },
    {
      q: 'Which GPUs and APIs are supported?',
      a: 'Consumer and data-centre NVIDIA GPUs can serve open-lane jobs through the Docker node agent. The API is OpenAI-compatible for chat completions, embeddings and images.',
    },
    {
      q: 'What does a receipt prove?',
      a: 'A signed COSE receipt binds the job, node key and metered work. Verification checks the signature and billing match. It does not prove the answer was correct.',
    },
    {
      q: 'Which compute lane is private?',
      a: 'The open lane is not private from the node operator. The sealed lane is designed for confidential execution on eligible hardware with attestation, and is in testing. Consumer GPUs are never confidential.',
    },
    {
      q: 'How do claims, cards and stocks work?',
      a: 'Claims always go to your wallet first and you pay the gas. From there you can fund a virtual card in one flow, or swap into a curated Stock Token with a quote and a price-impact warning. Card programs follow third-party terms.',
    },
    {
      q: 'Who issues the card and the Stock Tokens?',
      a: 'The virtual card is issued by a third-party card program, so availability, regions, limits and verification requirements are theirs. Stock Tokens are issued by third parties and carry no shareholder rights. Spindle shows the quote and price impact before you sign a swap.',
    },
    {
      q: 'How does node onboarding work?',
      a: 'Install the node agent, benchmark the GPU, then register the node with a wallet transaction. Staking is optional: it places the node in a priority tier for routing and is not needed to serve.',
    },
  ] satisfies FAQItem[],
};

export const closing = {
  title: 'Your compute. Your payout.',
  body: 'Explore how Spindle connects GPU supply, verifiable AI work and a choice of payout routes on Robinhood Chain.',
  ctas: [CTA_DASHBOARD, { label: 'Explore lanes', to: '/compute-lanes', variant: 'secondary' } as Cta],
};

export const marquee = [
  'Sealed lane (in testing)',
  'USDG',
  'Receipts',
  'Open lane',
  'Stock Tokens',
  'Virtual card',
  'USDG',
];

export const featureTabs = [
  {
    id: 'verified-work',
    label: 'Verified Work',
    icon: 'gpu',
    title: 'Every completed job leaves a receipt.',
    body: 'Signed work records link your node, the job and its metering to an hourly receipt root.',
    panel: 'receipt',
  },
  {
    id: 'node-dashboard',
    label: 'Node Dashboard',
    icon: 'overview',
    title: 'One view from node to claim.',
    body: 'Node status, job receipts and claims in one place. Preview data shows the intended flow.',
    panel: 'dashboard',
  },
  {
    id: 'claim-routing',
    label: 'Claim Routing',
    icon: 'routes',
    title: 'Claim to your wallet, then choose.',
    body: 'Claims land in your wallet in USDG. Then fund a virtual card or swap into a Stock Token, each as a separate step you sign.',
    panel: 'claim',
  },
  {
    id: 'compute-stack',
    label: 'Compute Stack',
    icon: 'stack',
    title: 'A stack built around verifiable compute.',
    body: 'Docker nodes, an OpenAI-compatible API and on-chain receipts connect providers with AI demand.',
    panel: 'stack',
  },
] as const;

export const receiptDemo = {
  title: 'Inspect receipt',
  tag: 'Illustrative flow',
  question: 'How does completed work become a payout?',
  answer:
    'Each completed job emits a signed receipt. Verified earnings accrue in USDG and enter an hourly Merkle root.',
  input: 'Which payout?',
};

export const howVisuals = {
  receipt: ['receipt.cose', 'Job proof', 'epoch.root', 'Merkle proof'],
  payout: ['Claim USDG to wallet', 'Fund a virtual card', 'Swap to a Stock Token'],
};
