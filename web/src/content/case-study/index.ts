export type Flow = {
  slug: string;
  oldSlug: string;
  title: string;
  stage: string;
  role: string;
  image: string;
  start: string;
  flow: string;
  outcome: string;
  facts: string[];
};

export const FLOWS: Flow[] = [
  {
    slug: 'provider-registration',
    oldSlug: 'globaltech-automates-it-helpdesk-operations-freeing-up-3-000-annual-hours',
    title: 'A GPU Provider’s Path from Node Registration to Signed Work Receipts',
    stage: 'From completed job to a signed receipt',
    role: 'GPU providers',
    image: '/assets/stock/wood-spiral-web-v10.webp',
    start:
      'Illustrative flow: a GPU provider wants to supply suitable compute and understand how a completed AI job becomes a work record. The provider needs a benchmarked GPU, a node identity and a clear distinction between confidential hardware and the open lane. Available hardware does not itself guarantee demand or earnings.',
    flow: 'The provider installs the Docker node agent. It benchmarks GPU capability, creates a node key, and the provider registers the node from their wallet. Registration is required; staking is optional and adds a routing priority tier. The scheduler matches suitable jobs by lane, VRAM fit, latency and reputation. Completed jobs produce signed receipts; verified work accrues in USDG and enters the next cumulative receipt epoch.',
    outcome:
      'The intended outcome is one view from node registration through job verification and hourly receipt roots. There are two compute lanes in the design, the sealed one in testing, and USDG is the unit of earnings. This is a walkthrough, with no live node count, utilization promise or projected income.',
    facts: ['COSE signed work receipts', 'Hourly cumulative receipt epochs', 'Robinhood Chain receipt roots'],
  },
  {
    slug: 'operator-identity',
    oldSlug: 'finedge-bank-cuts-fraud-detection-time-by-80-using-ai-automation',
    title: 'A Node Operator’s View of Registered Identity and Verified Job Receipts',
    stage: 'Signed work verification',
    role: 'Node operators',
    image: '/assets/stock/stone-helix-web-v10.webp',
    start:
      'Illustrative flow: a node operator needs to connect completed AI work to the node that served it, the units billed and the earnings recorded. A hardware label alone does not establish that work occurred. Registered node identity and signed receipts are the common references for this path.',
    flow: 'The node signs a COSE receipt for each job. A verifier checks its signature, the job-to-billing match and token counts against the gateway. Eligible sealed-lane nodes attach attestation evidence. Metering applies the rate card to verified work, then an epoch builder records cumulative entitlement in an hourly Merkle root on Robinhood Chain.',
    outcome:
      'The intended outcome is a traceable path from node identity to signed work and an hourly receipt epoch. This explains the architecture and is not a deployed customer result. A receipt evidences execution on the measured stack; it does not prove the output was correct.',
    facts: [
      'COSE signed work receipts',
      'Hourly cumulative receipt epochs',
      'Registry and receipt roots on Robinhood Chain',
    ],
  },
  {
    slug: 'sealed-request',
    oldSlug: 'medicore-health-reduces-no-shows-by-60-using-smarter-scheduling',
    title: 'An AI Builder’s Request through the Attested Sealed Compute Lane',
    stage: 'Sealed lane flow (in testing)',
    role: 'AI builders',
    image: '/assets/stock/spiral-lightwell-web-v10.webp',
    start:
      'Illustrative flow: an AI builder has a workload that requires a defined confidentiality boundary. Routing it to an ordinary consumer GPU would not make the prompts private from the operator. The sealed-lane design instead requires eligible confidential GPUs and a TDX environment with current attestation. The lane is in testing.',
    flow: 'The builder selects the sealed lane in the compatible API request. The OHTTP relay passes the encrypted body to the gateway and the eligible node decrypts it within the confidential environment. The completed job returns a response and a signed receipt linked to environment, model and GPU evidence. The design leaves the host operator with ciphertext.',
    outcome:
      'The intended outcome is private execution inside the defined sealed-lane boundary, with attested work records. This is an architecture flow rather than a customer deployment or a security audit. The open lane is not confidential, and the disclosed TEE limitations still apply.',
    facts: ['OHTTP relay', 'TDX and GPU attestation', 'In testing'],
  },
  {
    slug: 'payout-routes',
    oldSlug: 'shopflow-scales-customer-support-10x-without-increasing-headcount-or-costs',
    title: 'A Provider’s Path from USDG Claim to Card or Stock Token',
    stage: 'Claim and payout flow',
    role: 'Payout explorers',
    image: '/assets/stock/white-spiral-web-v10.webp',
    start:
      'Illustrative flow: a GPU provider has verified USDG earnings and wants to decide what to do with them. Selling a separate earnings token is not part of the flow. The provider first claims USDG to their own wallet, and can then fund a card or swap to a stock token, subject to program conditions.',
    flow: 'The dashboard builds the claim against the provider’s cumulative Merkle entitlement, and the provider signs it from their wallet. To use a card, they fund it from the wallet through izipay and a Relay route. To hold a stock token, they swap USDG for a token on the curated stock list after reviewing the quote and price impact. Each step is its own wallet transaction.',
    outcome:
      'The outcome is one claim route into the wallet, with the card and the swap as separate steps that follow. Card regions and program terms, and stock token availability and liquidity, shape availability. This is an illustrative flow, not a record of issued cards, completed payouts or financial returns.',
    facts: ['USDG claim to wallet', 'Curated stock list', 'Card funded from wallet'],
  },
];

export const FLOW_BY_SLUG = Object.fromEntries(FLOWS.map((f) => [f.slug, f]));
