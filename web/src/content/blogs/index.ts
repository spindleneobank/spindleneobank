export type Post = {
  slug: string;
  oldSlug: string;
  category: 'Architecture' | 'Compute' | 'Claim flow';
  title: string;
  lead: string;
  image: string;
  date: string;
  sections: { heading: string; body: string }[];
};

const DATE = 'October 10, 2026';

export const POSTS: Post[] = [
  {
    slug: 'from-gpu-work-to-claims',
    oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
    category: 'Architecture',
    title: 'How Spindle Connects GPU Work, Signed Receipts and Provider Claims',
    lead: 'A clear path connects AI requests, verified work and payout choice.',
    image: '/assets/stock/mineral-color-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Start with the node and compute lane',
        body: 'Spindle’s flow begins with the Docker node agent. It benchmarks the GPU, detects confidential-compute support, creates a node key and registers the node from the owner’s wallet on Robinhood Chain. Registration is required before a node can serve. Hardware capability decides whether the node can join the open lane or, once it leaves testing, the sealed lane.',
      },
      {
        heading: 'Follow the AI request',
        body: 'AI builders use the OpenAI-compatible gateway for chat, embeddings and images. A request selects a compute lane. The scheduler chooses a suitable node using lane, VRAM fit, latency and reputation, with staked nodes in a priority tier. Sealed requests use the eligible confidential stack; open requests must be non-sensitive.',
      },
      {
        heading: 'Link completed work to a receipt',
        body: 'The node emits a signed COSE receipt when a job completes. Verification checks its signature and metering against the gateway record. Verified work accrues in USDG and enters a cumulative Merkle tree, with an hourly root posted on Robinhood Chain.',
      },
      {
        heading: 'Claim to your wallet, then choose',
        body: 'A provider claims USDG to their own wallet with a Merkle proof. From the wallet they can fund a card or swap to a stock token from the curated stock list. Quotes, liquidity, supported regions and program terms shape the available options. This site explains the design and does not promise availability, demand or earnings.',
      },
    ],
  },
  {
    slug: 'hourly-receipt-roots',
    oldSlug: 'complex-workflows-need-structure-to-remain-fast',
    category: 'Compute',
    title: 'How Hourly Receipt Roots Record Cumulative Provider Earnings',
    lead: 'Signed receipts connect each job to its metered work.',
    image: '/assets/stock/purple-universe-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Start with a signed job receipt',
        body: 'Each completed job emits a COSE receipt signed by its node key. The receipt links the job, node and metering record. In the sealed lane it also carries references to attestation evidence. The receipt shows execution on the measured stack; it does not prove the answer was correct.',
      },
      {
        heading: 'Verify before metering earnings',
        body: 'The verifier checks the signature, job-to-billing match and measured token counts. Metering applies the posted rate card to verified work and records the resulting USDG amount in the earnings ledger. The provider share is 80% of the buyer charge. SPDL is used for access and optional staking, not as the unit of earnings.',
      },
      {
        heading: 'Build an hourly cumulative root',
        body: 'The epoch builder creates a cumulative Merkle tree every hour and a poster address publishes its root on Robinhood Chain. A leaf records the owner and cumulative earned amount. The claims contract tracks the amount already claimed, so an older proof can never pay more than is owed.',
      },
      {
        heading: 'Keep the proof with the claim',
        body: 'A claim uses the epoch, cumulative amount and Merkle proof. The contract refuses a root that its balance cannot cover, and a guardian can veto a pending root during its delay window. The website illustrates these steps without presenting live receipts, balances or completed claims.',
      },
    ],
  },
  {
    slug: 'claim-routes',
    oldSlug: 'connected-processes-become-difficult-without-clear-systems',
    category: 'Claim flow',
    title: 'How Claims, Cards and Stock Tokens Share One Ledger',
    lead: 'Every claim pays your wallet first. Cards and swaps follow from there.',
    image: '/assets/stock/crystalline-granite-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'One earnings unit, one claim',
        body: 'Spindle meters verified work in USDG. A provider claims USDG to their wallet with the Merkle proof from the dashboard, and pays the gas for that transaction. Claims never go straight to a card or a swap; they always arrive in the wallet.',
      },
      {
        heading: 'Swap to a stock token with a quote first',
        body: 'From the wallet, a provider can swap USDG to a token on the curated stock list. The swap shows a quote and price impact, with minimum-output protection. If price impact is too high, the interface suggests a smaller swap rather than hiding the tradeoff.',
      },
      {
        heading: 'Fund a card from the wallet',
        body: 'To use a card, the provider funds it from the wallet. The card program issues the card through izipay, and a Relay route moves the funds into it. Each step is a separate, signed wallet transaction, tracked by an operation record. Card regions, limits and verification belong to the card program.',
      },
      {
        heading: 'Why the ledger stays simple',
        body: 'Because claims only ever pay the wallet, one cumulative claimed balance covers everything. The same work cannot be claimed twice, whatever the owner does with the funds afterwards. Route-specific costs and third-party conditions apply to cards and swaps.',
      },
    ],
  },
  {
    slug: 'sealed-lane',
    oldSlug: 'smart-automation-keeps-every-process-simple-and-scalable',
    category: 'Architecture',
    title: 'How the Sealed Lane Keeps Prompts Inside Eligible Attested GPUs',
    lead: 'Confidential compute belongs in the attested sealed lane, which is in testing.',
    image: '/assets/stock/concrete-stair-room-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Privacy belongs to a specific lane',
        body: 'The sealed lane is designed for confidential-compute GPUs in an eligible TDX environment. The node decrypts the request inside that environment and returns the response with an attested receipt. The host operator sees ciphertext rather than the prompt body in this flow. The lane is in testing and is not generally available.',
      },
      {
        heading: 'Route the encrypted request',
        body: 'An OHTTP relay sits between the buyer and the sealed gateway. Attestation checks cover the environment, GPU evidence and allowed measurements. These steps describe the privacy architecture; they are not a blanket claim that every GPU or every job is confidential.',
      },
      {
        heading: 'Distinguish the open lane clearly',
        body: 'Consumer GPUs and non-confidential hardware serve non-sensitive open-lane work. Operators may see open-lane prompts. Public-model batch inference, embeddings, evaluations and image generation are examples of work that can fit that lane.',
      },
      {
        heading: 'Understand the attestation boundary',
        body: 'The design discloses limitations, including absent TDISP device binding and physical attacks outside its scope. Signed receipts show that work ran on a measured stack; they do not certify that a generated answer is correct.',
      },
    ],
  },
  {
    slug: 'scheduler-and-lanes',
    oldSlug: 'growing-teams-need-workflows-built-for-flexibility',
    category: 'Compute',
    title: 'How the Scheduler Matches AI Workloads to Suitable GPU Nodes',
    lead: 'GPU capability decides which compute lane can serve a job.',
    image: '/assets/stock/concrete-platform-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Hardware determines the available lane',
        body: 'A node agent benchmarks the GPU and detects confidential-compute capability during onboarding. The design separates sealed-lane eligible confidential hardware from consumer GPUs and other open-lane hardware. A scheduler routes each job according to both the workload and the node’s capabilities.',
      },
      {
        heading: 'Match jobs to suitable nodes',
        body: 'Routing considers compute lane, VRAM fit, latency and reputation. Nodes that stake SPDL join a priority tier; staking is optional and registration is what makes a node eligible to serve. The open lane handles non-sensitive workloads such as public-model batch inference, embeddings, evaluations and image generation.',
      },
      {
        heading: 'Keep earnings tied to buyer demand',
        body: 'The rate card is posted by GPU class, lane and work unit. Providers earn from verified jobs funded by buyer spend. Demand can change, and available hardware does not imply guaranteed utilization or income. A temporary availability floor is capped and decays to zero.',
      },
      {
        heading: 'Follow the path through the dashboard',
        body: 'The dashboard brings node state, lane, receipts, epochs and claim steps into one place. Charts on this site are labelled as examples rather than live network activity or current earnings.',
      },
    ],
  },
  {
    slug: 'node-identity-and-reputation',
    oldSlug: 'better-systems-reduce-delays-across-daily-operations',
    category: 'Claim flow',
    title: 'How Node Identity, Stake and Reputation Fit the Compute Network',
    lead: 'Registered identity and receipt checks support node accountability.',
    image: '/assets/stock/concrete-empty-hall-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Give each node a registered identity',
        body: 'A node key is registered on Robinhood Chain from the owner’s wallet and linked to an ERC-8004 identity. Registration records GPU class and confidential-compute capability, and is required before the node can serve. The identity gives the scheduler and receipt verifier a consistent reference for the node that served a job.',
      },
      {
        heading: 'Stake is an optional priority tier',
        body: 'SPDL is an access and routing token, not the unit of provider earnings. Staking is optional. A node that holds at least the stake minimum for its GPU class enters a routing priority tier. Unstaked nodes can still serve, with lower priority.',
      },
      {
        heading: 'Check the work as it arrives',
        body: 'The receipt verifier checks the node signature, matches the job to billing and compares measured units with the gateway record. Known-answer canary jobs and periodic hardware probes are additional checks. These are verification mechanisms, not a guarantee of output correctness.',
      },
      {
        heading: 'Make the limits visible',
        body: 'Completed buyer-funded work determines earnings. A node’s hardware does not create a guaranteed payment, and consumer GPUs are not confidential compute. These limits matter when comparing the open and sealed lanes or deciding whether to supply a GPU.',
      },
    ],
  },
  {
    slug: 'compatible-api',
    oldSlug: 'unified-workflows-help-teams-move-faster-together',
    category: 'Architecture',
    title: 'How Builders Use Chat, Embeddings and Image Endpoints',
    lead: 'One compatible API links AI builders to the compute network.',
    image: '/assets/stock/amber-steel-web-v10.webp',
    date: DATE,
    sections: [
      {
        heading: 'Build against a familiar request shape',
        body: 'The gateway uses OpenAI-compatible endpoints for chat completions, embeddings and images. Builders select a compute lane for the request instead of assuming all GPUs offer the same privacy. A completed job has a receipt that can be retrieved by its job ID.',
      },
      {
        heading: 'Choose the request’s compute lane',
        body: 'The X-Spindle-Lane header selects sealed or open. The sealed lane requires eligible confidential GPUs and current attestation, and is in testing. The open lane serves non-sensitive requests on suitable hardware, including consumer GPUs. The selection is a privacy and hardware decision, not a visual setting.',
      },
      {
        heading: 'Connect payment to the job',
        body: 'Buyers can deposit USDG into the BuyerVault for an API balance, or pay per call with x402, which adds a small surcharge to cover settlement gas. Of each charge, 80% goes to the provider pool and 20% to the treasury. Production access details are not represented by this website.',
      },
      {
        heading: 'Retrieve the work record',
        body: 'The receipt endpoint links the builder’s completed request to its signed COSE work record. A receipt can support execution and billing checks without asserting that an answer is correct.',
      },
    ],
  },
];

export const POST_BY_SLUG = Object.fromEntries(POSTS.map((p) => [p.slug, p]));
