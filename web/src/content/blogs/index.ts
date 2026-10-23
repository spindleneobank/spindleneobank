/**
 * Field notes (/blogs). Copy is the old site's rendered text, verbatim (docs/plan/parity-1to1.md), except the approved
 * rows in docs/plan/parity-text-exceptions.md.
 */
import type { Img } from '../changelog';

export type Block = { t: 'h4' | 'p'; text: string } | ({ t: 'img' } & Img);
export type Post = {
  slug: string;
  oldSlug: string;
  category: 'Architecture' | 'Compute' | 'Claim flow';
  /** Bold line of the index card (the old CMS "title" field). */
  bold: string;
  /** Muted line of the index card. */
  dim: string;
  cardImg: Img;
  /** The h1 of the post page. */
  title: string;
  hero: Img;
  body: Block[];
  preparedFrom: string;
  asideCategory: string;
  date: string;
  related: { oldSlug: string; img: Img }[];
};

export const BLOGS_HERO = {
  badge: 'Field notes & guides',
  title: 'Compute field notes',
  lead: 'Explore the Spindle specification: compute lanes, signed receipts, bonded identity and the path from GPU work to payout choice.',
  heading: 'Design notes',
  search: 'Search',
} as const;
export const BLOG_CATEGORIES = ['All', 'Architecture', 'Compute', 'Claim flow'] as const;

export const POSTS: Post[] = [
  {
    slug: 'from-gpu-work-to-claims',
    oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
    category: 'Architecture',
    bold: 'How Spindle Connects GPU Work, Signed Receipts and Provider Claims',
    dim: 'A clear path connects AI requests, verified work and payout choice.',
    cardImg: {
      src: '/assets/stock/mineral-color-web-v10.webp',
      alt: 'Rough mineral surface with blue and red patches',
      filter: 'orchid',
    },
    title: 'How Spindle Connects GPU Work, Signed Receipts and Provider Claims',
    hero: {
      src: '/assets/stock/diagonal-monochrome-web-v10.webp',
      alt: 'Monochrome Geometric Background',
      filter: 'amber',
    },
    body: [
      {
        t: 'h4',
        text: 'Start with the node and compute lane',
      },
      {
        t: 'p',
        text: 'Spindle’s proposed flow begins with the Docker node agent. It benchmarks the GPU, detects confidential-compute support, creates a node key and registers the node through a wallet signature on Robinhood Chain. Hardware capability decides whether the node can join the sealed lane or the open lane.',
      },
      {
        t: 'img',
        src: '/assets/stock/geometric-spike-web-v10.webp',
        alt: 'Abstract Geometric Wallpaper',
        filter: 'orchid',
      },
      {
        t: 'h4',
        text: 'Follow the AI request',
      },
      {
        t: 'p',
        text: 'AI builders use the OpenAI-compatible gateway design for chat, embeddings and images. A request selects a compute lane. The scheduler chooses a suitable node using lane, VRAM fit, latency, stake and reputation. Sealed requests use the eligible confidential stack; open requests must be non-sensitive.',
      },
      {
        t: 'h4',
        text: 'Link completed work to a receipt',
      },
      {
        t: 'p',
        text: 'The node emits a signed COSE receipt when a job completes. Verification checks its signature and metering against the gateway record. Verified work accrues in USDG and enters a cumulative Merkle tree, with an hourly root posted on Robinhood Chain.',
      },
      {
        t: 'h4',
        text: 'Choose the claim route',
      },
      {
        t: 'p',
        text: 'A provider can inspect the intended claim flow for USDG, a canonical Stock Token or a virtual card. Quotes, liquidity, supported regions and program terms shape the available options. This site explains the v1.1 design and does not promise live availability, demand or earnings.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Architecture',
    related: [
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/triangular-facade-web-v10.webp',
          alt: 'Triangular Geometric Facade',
          filter: 'orchid',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/paper-triangle-web-v10.webp',
          alt: 'Abstract Geometric Paper Composition',
          filter: 'amber',
        },
      },
      {
        oldSlug: 'smart-automation-keeps-every-process-simple-and-scalable',
        img: {
          src: '/assets/stock/glass-refraction-grid-web-v10.webp',
          alt: 'Refraction: Abstract Geometric Wallpaper',
          filter: 'orchid',
        },
      },
    ],
  },
  {
    slug: 'hourly-receipt-roots',
    oldSlug: 'complex-workflows-need-structure-to-remain-fast',
    category: 'Compute',
    bold: 'Signed receipts connect each job to its metered work.',
    dim: 'How Hourly Receipt Roots Record Cumulative Provider Earnings',
    cardImg: {
      src: '/assets/stock/purple-universe-web-v10.webp',
      alt: 'Purple glass bubbles and refraction',
      filter: 'ember',
    },
    title: 'Signed receipts connect each job to its metered work.',
    hero: {
      src: '/assets/stock/bubble-nebula-web-v10.webp',
      alt: 'Bubble nebula amidst a dense star field',
      filter: 'orchid',
    },
    body: [
      {
        t: 'h4',
        text: 'Start with a signed job receipt',
      },
      {
        t: 'p',
        text: 'Each completed job emits a COSE receipt signed by its node key. The receipt links the job, node and metering record. In the sealed lane it also carries references to attestation evidence. The receipt proves execution on the measured stack; it does not prove the answer was correct.',
      },
      {
        t: 'img',
        src: '/assets/stock/sh2-nebula-web-v10.webp',
        alt: 'SH2-115 nebula clouds',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'Verify before metering earnings',
      },
      {
        t: 'p',
        text: 'The verifier checks the signature, job-to-billing match and measured token counts. Metering applies the posted rate card to verified work and records the resulting USDG amount in the earnings ledger. SPDL is used for access and stake, rather than as the unit of earnings.',
      },
      {
        t: 'h4',
        text: 'Build an hourly cumulative root',
      },
      {
        t: 'p',
        text: 'The epoch builder creates a cumulative Merkle tree every hour and posts its root on Robinhood Chain. A leaf records the owner and cumulative earned amount. The shared claim accounting tracks amounts already consumed across wallet, stock and card routes.',
      },
      {
        t: 'h4',
        text: 'Keep the proof with the claim',
      },
      {
        t: 'p',
        text: 'A claim uses the epoch, cumulative amount and Merkle proof. The design checks funding before accepting a root and uses a common claimed balance across payout routes. The website illustrates these steps without presenting live receipts, balances or completed claims.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Compute',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/wizard-nebula-web-v10.webp',
          alt: 'Wizard nebula and central star',
          filter: 'orchid',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/white-concrete-blocks-web-v10.webp',
          alt: 'White concrete protruding rectangular volumes',
          filter: 'orchid',
        },
      },
      {
        oldSlug: 'smart-automation-keeps-every-process-simple-and-scalable',
        img: {
          src: '/assets/stock/grainy-brutalism-web-v10.webp',
          alt: 'Grainy monochrome brutalist walkway and balconies',
          filter: 'amber',
        },
      },
    ],
  },
  {
    slug: 'claim-routes',
    oldSlug: 'connected-processes-become-difficult-without-clear-systems',
    category: 'Claim flow',
    bold: 'Three payout routes share one cumulative claim entitlement.',
    dim: 'How USDG Claims, Stock Swaps and Card Funding Share One Ledger',
    cardImg: {
      src: '/assets/stock/crystalline-granite-web-v10.webp',
      alt: 'Granite crystal macro texture',
      filter: 'orchid',
    },
    title: 'Three payout routes share one cumulative claim entitlement.',
    hero: {
      src: '/assets/stock/layered-bunker-web-v10.webp',
      alt: 'Layered sculptural concrete bunker',
      filter: 'amber',
    },
    body: [
      {
        t: 'h4',
        text: 'One earnings unit, several claim routes',
      },
      {
        t: 'p',
        text: 'The Spindle specification meters verified work in USDG. Providers claim USDG to a wallet, then can swap to a Stock Token or fund a virtual card. The available route depends on eligibility, liquidity and the relevant third-party program terms.',
      },
      {
        t: 'img',
        src: '/assets/stock/window-grid-web-v10.webp',
        alt: 'Diagonal window grid in concrete building',
        filter: 'orchid',
      },
      {
        t: 'h4',
        text: 'Quote a Stock Token swap first',
      },
      {
        t: 'p',
        text: 'The stock route checks the curated stock list before execution. The claim flow shows a quote and price impact, with minimum-output protection. If price impact is too high, the design suggests a smaller claim or the USDG route rather than hiding the tradeoff.',
      },
      {
        t: 'h4',
        text: 'Fund the card from claimed USDG',
      },
      {
        t: 'p',
        text: 'The card step spends claimed USDG from your wallet before requesting issuance from the card program. A claim identifier keeps retries idempotent. The backend design credits USDG back if issuance fails, while card details are revealed through the provider-hosted view .',
      },
      {
        t: 'h4',
        text: 'Use one shared entitlement',
      },
      {
        t: 'p',
        text: 'USDG claims, stock swaps and card funding start from the same claimed balance. This is the mechanism intended to prevent the same work being claimed twice across different routes. Route-specific costs and third-party conditions apply to claims.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Claim flow',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/mineral-strata-web-v10.webp',
          alt: 'Red yellow and white mineral strata',
          filter: 'ember',
        },
      },
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/shell-macro-web-v10.webp',
          alt: 'Oyster exterior photographed as crystalline texture',
          filter: 'ember',
        },
      },
      {
        oldSlug: 'smart-automation-keeps-every-process-simple-and-scalable',
        img: {
          src: '/assets/stock/quartz-veins-web-v10.webp',
          alt: 'Weathered dark rock and pale quartz veins',
          filter: 'orchid',
        },
      },
    ],
  },
  {
    slug: 'sealed-lane',
    oldSlug: 'smart-automation-keeps-every-process-simple-and-scalable',
    category: 'Architecture',
    bold: 'Confidential compute belongs in the sealed lane (in testing).',
    dim: 'How the Sealed Lane (in Testing) Keeps Prompts Inside Attested GPUs',
    cardImg: {
      src: '/assets/stock/concrete-stair-room-web-v10.webp',
      alt: 'Empty concrete interior with angular stairs',
      filter: 'orchid',
    },
    title: 'Confidential compute belongs in the sealed lane (in testing).',
    hero: {
      src: '/assets/stock/light-crystals-web-v10.webp',
      alt: 'Light Chrystals III',
      filter: 'amber',
    },
    body: [
      {
        t: 'h4',
        text: 'Privacy belongs to a specific lane',
      },
      {
        t: 'p',
        text: 'The sealed lane is designed for confidential-compute GPUs in an eligible TDX environment. The node decrypts the request inside that environment and returns the response with an attested receipt. The host operator sees ciphertext rather than the prompt body in this flow.',
      },
      {
        t: 'img',
        src: '/assets/stock/snow-prisms-web-v10.webp',
        alt: 'Snow Crystal Macro',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'Route the encrypted request',
      },
      {
        t: 'p',
        text: 'An OHTTP relay sits between the buyer and the sealed gateway. Attestation checks cover the environment, GPU evidence and allowed measurements. These steps describe the privacy architecture in the specification; they are not a blanket claim that every GPU or every job is confidential.',
      },
      {
        t: 'h4',
        text: 'Distinguish the open lane clearly',
      },
      {
        t: 'p',
        text: 'Consumer GPUs and non-confidential hardware serve non-sensitive open-lane work. Operators may see open-lane prompts. Public-model batch inference, embeddings, evaluations and image generation are examples of work that can fit that lane when the inputs are suitable.',
      },
      {
        t: 'h4',
        text: 'Understand the attestation boundary',
      },
      {
        t: 'p',
        text: 'The specification discloses limitations, including absent TDISP device binding and physical attacks outside its scope. Signed receipts show that work ran on a measured stack; they do not certify that a generated answer is correct. These boundaries remain part of the product explanation.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Architecture',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/clear-crystal-fan-web-v10.webp',
          alt: 'Clear Crystal Macro',
          filter: 'amber',
        },
      },
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/amethyst-closeup-web-v10.webp',
          alt: 'Amethyst Crystal Close-Up',
          filter: 'ember',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/blue-crystal-shards-web-v10.webp',
          alt: 'Blue-Grey Crystal Macro',
          filter: 'amber',
        },
      },
    ],
  },
  {
    slug: 'scheduler-and-lanes',
    oldSlug: 'growing-teams-need-workflows-built-for-flexibility',
    category: 'Compute',
    bold: 'GPU capability decides which compute lane can serve a job.',
    dim: 'How the Scheduler Matches AI Workloads to Suitable GPU Nodes',
    cardImg: {
      src: '/assets/stock/concrete-platform-web-v10.webp',
      alt: 'Concrete platform supported by cylindrical pillars',
      filter: 'orchid',
    },
    title: 'GPU capability decides which compute lane can serve a job.',
    hero: {
      src: '/assets/stock/polished-sculpture-web-v10.webp',
      alt: 'Polished organic metal sculpture in minimalist gallery',
      filter: 'ember',
    },
    body: [
      {
        t: 'h4',
        text: 'Hardware determines the available lane',
      },
      {
        t: 'p',
        text: 'A node agent benchmarks the GPU and detects confidential-compute capability during onboarding. The specification separates sealed-lane eligible confidential hardware from consumer GPUs and other open-lane hardware. A scheduler routes each job according to both the workload and the node’s capabilities.',
      },
      {
        t: 'img',
        src: '/assets/stock/arched-corridor-web-v10.webp',
        alt: 'Arched Walkway in Monochrome',
        filter: 'amber',
      },
      {
        t: 'h4',
        text: 'Match jobs to suitable nodes',
      },
      {
        t: 'p',
        text: 'Routing considers compute lane, VRAM fit, stake weight, latency and reputation. The sealed lane (in testing) is for private jobs on the attested stack. The open lane handles non-sensitive workloads such as public-model batch inference, embeddings, evaluations and image generation.',
      },
      {
        t: 'h4',
        text: 'Keep earnings tied to buyer demand',
      },
      {
        t: 'p',
        text: 'The rate card is posted by GPU class, lane and work unit. Providers earn from verified jobs funded by buyer spend. Demand can change, and available hardware does not imply guaranteed utilization or income. The specification’s temporary availability floor is capped and decays to zero.',
      },
      {
        t: 'h4',
        text: 'Follow the path through the dashboard',
      },
      {
        t: 'p',
        text: 'The dashboard design brings node state, lane, receipts, epochs and claim routes into one place. This preview illustrates that information architecture. Values and charts are labelled as examples rather than live network activity, current earnings or a service-level commitment.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Compute',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/stair-shadows-web-v10.webp',
          alt: 'Grayscale Concrete Staircase',
          filter: 'amber',
        },
      },
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/brick-shadow-geometry-web-v10.webp',
          alt: 'Geometric Shadows in a Brutalist Interior',
          filter: 'amber',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/faceted-building-light-web-v10.webp',
          alt: 'Abstract Architectural Facade',
          filter: 'amber',
        },
      },
    ],
  },
  {
    slug: 'node-identity-and-reputation',
    oldSlug: 'better-systems-reduce-delays-across-daily-operations',
    category: 'Claim flow',
    bold: 'Bonded identity and receipt checks support node accountability.',
    dim: 'How Node Identity, Stake and Reputation Fit the Compute Network',
    cardImg: {
      src: '/assets/stock/concrete-empty-hall-web-v10.webp',
      alt: 'Empty concrete room and geometric sunlight',
      filter: 'ember',
    },
    title: 'Bonded identity and receipt checks support node accountability.',
    hero: {
      src: '/assets/stock/steel-beam-geometry-web-v10.webp',
      alt: 'Abstract intersecting steel beam geometry',
      filter: 'ember',
    },
    body: [
      {
        t: 'h4',
        text: 'Give each node a bonded identity',
      },
      {
        t: 'p',
        text: 'The Spindle design links a node key to an ERC-8004 identity owned by an operator wallet. Registration records GPU class and confidential-compute capability. The identity gives the scheduler and receipt verifier a consistent reference for the node that served a job.',
      },
      {
        t: 'img',
        src: '/assets/stock/metal-slats-web-v10.webp',
        alt: 'Parallel metal slats and shallow focus',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'Connect stake to the node role',
      },
      {
        t: 'p',
        text: 'SPDL is an access and routing token in the specification, not the unit of provider earnings. The minimum stake scales with GPU class. The design uses stake and reputation alongside VRAM fit, latency and compute lane when choosing a suitable node for a job.',
      },
      {
        t: 'h4',
        text: 'Check the work as it arrives',
      },
      {
        t: 'p',
        text: 'The receipt verifier checks the node signature, matches the job to billing and compares measured units with the gateway record. Known-answer canary jobs and periodic hardware probes are additional checks in the design. These are verification mechanisms, not a guarantee of output correctness.',
      },
      {
        t: 'h4',
        text: 'Make the limits visible',
      },
      {
        t: 'p',
        text: 'Completed buyer-funded work determines earnings. A node’s hardware does not create a guaranteed payment, and consumer GPUs are not confidential compute. These limits matter when comparing the open lane with the sealed lane (in testing) or deciding whether to supply a GPU.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Claim flow',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/pelican-nebula-web-v10.webp',
          alt: 'Pelican nebula and interstellar dust',
          filter: 'ember',
        },
      },
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/nasa-nebula-web-v10.webp',
          alt: 'Dense nebula gas filaments and stars',
          filter: 'orchid',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/interstellar-nebula-web-v10.webp',
          alt: 'Glowing interstellar nebula with dark filaments',
          filter: 'orchid',
        },
      },
    ],
  },
  {
    slug: 'compatible-api',
    oldSlug: 'unified-workflows-help-teams-move-faster-together',
    category: 'Architecture',
    bold: 'One compatible API links AI builders to the compute network.',
    dim: 'How Builders Use Chat, Embeddings and Image Endpoints',
    cardImg: {
      src: '/assets/stock/amber-steel-web-v10.webp',
      alt: 'Intersecting metal panels in amber light',
      filter: 'ember',
    },
    title: 'One compatible API links AI builders to the compute network.',
    hero: {
      src: '/assets/stock/clear-crystal-macro-web-v10.webp',
      alt: 'Clear Crystal Cluster Macro',
      filter: 'amber',
    },
    body: [
      {
        t: 'h4',
        text: 'Build against a familiar request shape',
      },
      {
        t: 'p',
        text: 'The gateway design uses OpenAI-compatible endpoints for chat completions, embeddings and images. Builders select a compute lane for the request instead of assuming all GPUs offer the same privacy. A completed job has a receipt that can be retrieved by its job ID.',
      },
      {
        t: 'img',
        src: '/assets/stock/dark-sand-ridges-web-v10.webp',
        alt: 'Textured Dark Sand Dunes',
        filter: 'ember',
      },
      {
        t: 'h4',
        text: 'Choose the request’s compute lane',
      },
      {
        t: 'p',
        text: 'The X-Spindle-Lane header selects open; sealed in testing. The sealed lane requires eligible confidential GPUs and current attestation. The open lane serves non-sensitive requests on suitable hardware, including consumer GPUs. The selection is a privacy and hardware decision, not simply a visual setting.',
      },
      {
        t: 'h4',
        text: 'Connect payment to the job',
      },
      {
        t: 'p',
        text: 'The buyer payment design supports a USDG API balance or per-call x402 settlement. The scheduler sends accepted jobs to suitable nodes, and metering records verified work in USDG. Production access details and launch information are not represented by this illustrative website.',
      },
      {
        t: 'h4',
        text: 'Retrieve the work record',
      },
      {
        t: 'p',
        text: 'The receipt endpoint links the builder’s completed request to its signed COSE work record. A receipt can support execution and billing checks without asserting that an answer is correct. Providers then follow the hourly cumulative root and their chosen claim route.',
      },
    ],
    preparedFrom: 'Spindle specification',
    date: 'October 10, 2026',
    asideCategory: 'Architecture',
    related: [
      {
        oldSlug: 'how-to-design-scalable-multi-step-workflows-across-your-organization',
        img: {
          src: '/assets/stock/black-dune-texture-web-v10.webp',
          alt: 'Black Sand Dune Textures',
          filter: 'amber',
        },
      },
      {
        oldSlug: 'complex-workflows-need-structure-to-remain-fast',
        img: {
          src: '/assets/stock/sand-ripple-curve-web-v10.webp',
          alt: 'Rippled Sand Dune Patterns',
          filter: 'orchid',
        },
      },
      {
        oldSlug: 'connected-processes-become-difficult-without-clear-systems',
        img: {
          src: '/assets/stock/fine-sand-grain-web-v10.webp',
          alt: 'Grayscale Sand Texture',
          filter: 'amber',
        },
      },
    ],
  },
];

export const POST_BY_OLD_SLUG: Record<string, Post> = Object.fromEntries(POSTS.map((p) => [p.oldSlug, p]));

/** Share icons shown in the post aside (Phosphor, 256 viewBox): facebook, x, linkedin, link. */
export const SHARE_ICONS: string[] = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="rgba(243, 218, 205, 1)" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"></rect><circle cx="128" cy="128" r="96" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></circle><path d="M168,88H152a23.9,23.9,0,0,0-24,24V224" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></path><line x1="96" y1="144" x2="160" y2="144" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></line></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="rgba(243, 218, 205, 1)" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"></rect><path d="M128,88c0-22,18.5-40.3,40.5-40a40,40,0,0,1,36.2,24H240l-32.3,32.3A127.9,127.9,0,0,1,80,224c-32,0-40-12-40-12s32-12,48-36c0,0-64-32-48-120,0,0,40,40,88,48Z" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></path></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="rgba(243, 218, 205, 1)" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"></rect><rect x="36" y="36" width="184" height="184" rx="8" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></rect><line x1="120" y1="112" x2="120" y2="176" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></line><line x1="88" y1="112" x2="88" y2="176" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></line><path d="M120,140a28,28,0,0,1,56,0v36" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></path><circle cx="88" cy="80" r="12"></circle></svg>',
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="rgba(243, 218, 205, 1)" viewBox="0 0 256 256"><rect width="256" height="256" fill="none"></rect><path d="M45.4,177A95.9,95.9,0,1,1,79,210.6h0L45.8,220a7.9,7.9,0,0,1-9.8-9.8L45.4,177Z" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></path><path d="M152.1,184A79.9,79.9,0,0,1,72,103.9,28,28,0,0,1,100,76h0a6.8,6.8,0,0,1,6,3.5l11.7,20.4a8.1,8.1,0,0,1-.1,8.1l-9.4,15.7h0a48,48,0,0,0,24.1,24.1h0l15.7-9.4a8.1,8.1,0,0,1,8.1-.1L176.5,150a6.8,6.8,0,0,1,3.5,6h0A28.1,28.1,0,0,1,152.1,184Z" fill="none" stroke="rgba(243, 218, 205, 1)" stroke-linecap="round" stroke-linejoin="round" stroke-width="16"></path></svg>',
];
