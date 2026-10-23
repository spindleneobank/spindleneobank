export type Component = {
  slug: string;
  oldSlug: string;
  icon: string;
  title: string;
  lead: string;
  category: string;
  records: string;
  flow: string;
  dataFlow: string;
  boundary: string;
  fits: string;
  lifecycle: string;
};

const LIFECYCLE =
  'Claims only ever pay the owner wallet, so one cumulative claimed balance covers every later step and the same work cannot be claimed twice.';

export const COMPONENTS: Component[] = [
  {
    slug: 'node-registry',
    oldSlug: 'attio',
    icon: 'registry',
    title: 'Node registry',
    lead: 'The node registry links node keys, GPU class and identity on Robinhood Chain.',
    category: 'Registry',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'A node registers a key hash, GPU class, confidential-compute capability and attestation reference from its owner wallet, with an ERC-8004 identity linked to the node. Registration is required before a node can serve.',
    boundary:
      'Staking is optional. A node that holds the stake minimum for its GPU class joins a routing priority tier; unstaked nodes can still serve. Registration is not a guarantee of work, utilization or earnings. The registry contracts have no owner and no admin setters.',
    fits: 'The Docker node agent benchmarks hardware and builds the registration request for the owner’s wallet to sign.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'api-gateway',
    oldSlug: 'hubspot',
    icon: 'gateway',
    title: 'API gateway',
    lead: 'An OpenAI-compatible gateway accepts chat, embedding and image requests.',
    category: 'Gateway',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'The API supports chat completions, embeddings and images. Builders select the compute lane and pay from a USDG API balance in the BuyerVault, or per call with x402, which adds a small surcharge that covers settlement gas.',
    boundary:
      'Sealed requests use the eligible confidential stack and are in testing. Open-lane prompts are not private from the operator.',
    fits: 'Select the compute lane with the X-Spindle-Lane header. The gateway then routes the request to scheduling. Of each buyer charge, 80% goes to the provider pool and 20% to the treasury.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'receipt-ledger',
    oldSlug: 'airtable',
    icon: 'ledger',
    title: 'Receipt ledger',
    lead: 'Verified work is recorded as USDG earning events before an hourly root is built.',
    category: 'Work ledger',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'Signed receipts feed metering, which applies the rate card to verified work. The provider share is 80% of the buyer charge. The resulting USDG earning events link an owner, node and job to the cumulative entitlement used for claims.',
    boundary:
      'Receipts evidence work execution and metering; they do not prove that an AI output was correct. The ledger is a component of the design, not a live balance on this website.',
    fits: 'A verified receipt enters metering. The epoch builder gathers cumulative earnings and publishes the hourly Merkle root.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'scheduler',
    oldSlug: 'asana',
    icon: 'scheduler',
    title: 'Scheduler',
    lead: 'The scheduler matches accepted AI jobs to suitable nodes in the intended compute lane.',
    category: 'Job routing',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'Routing uses compute lane, VRAM fit, latency and reputation, with staked nodes in a priority tier. The same scheduler connects buyer demand to open-lane or eligible sealed-lane GPU supply.',
    boundary:
      'Open-lane jobs must be non-sensitive. Sealed-lane work requires the eligible confidential-compute stack and attestation, and the sealed lane is in testing.',
    fits: 'A request arrives through the gateway. The scheduler checks its lane and requirements before assigning a suitable registered node.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'node-benchmark',
    oldSlug: 'aws-inventory',
    icon: 'benchmark',
    title: 'Node benchmark',
    lead: 'The agent checks GPU class, available VRAM and confidential-compute capability.',
    category: 'Node hardware',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'Onboarding benchmarks the hardware and detects confidential-compute capability. Periodic benchmark and VRAM probes compare the node with its claimed GPU class.',
    boundary:
      'Consumer GPUs are not confidential. Only eligible attested hardware can serve sealed-lane jobs, and that lane is in testing.',
    fits: 'Install the Docker agent on suitable hardware. Benchmark results help register the node and choose its compute lane.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'epoch-builder',
    oldSlug: 'clickup',
    icon: 'epoch',
    title: 'Epoch builder',
    lead: 'Cumulative earnings are grouped into an hourly Merkle tree and posted on-chain.',
    category: 'Epoch records',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'The epoch builder gathers cumulative USDG earnings by owner, builds the Merkle tree and a fixed poster address publishes its root on Robinhood Chain. The proof supports the provider’s next claim.',
    boundary:
      'The claims contract has no owner. Its poster and slasher addresses are immutable, and a guardian can only veto a pending root during its delay window. It cannot move funds. The contract checks funding before accepting a root.',
    fits: 'Verified work enters the ledger. Hourly epochs turn that cumulative record into a root and a retrievable proof.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'source-code',
    oldSlug: 'github',
    icon: 'github',
    title: 'Source code',
    lead: 'Source and developer community details are coming soon.',
    category: 'Developer tools',
    records: 'Coming soon',
    flow: 'Specification',
    dataFlow:
      'Repository access is coming soon. This page describes the planned developer-facing material rather than a published repository.',
    boundary: 'This website does not connect to your GitHub account, read repositories or create issues.',
    fits: 'Use the dashboard and field notes to explore the design. Repository access details will be published separately.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'card-adapter',
    oldSlug: 'helpdesk',
    icon: 'card-adapter',
    title: 'Card adapter',
    lead: 'The card adapter funds a card from the owner wallet through izipay and Relay.',
    category: 'Card routing',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'Funding a card starts from USDG already in the owner wallet. An izipay invoice and a Relay quote set the route, and the owner approves and deposits from the wallet. Funds arrive as USDT on BSC or TRON and are credited to the card. An idempotent operation ID ties each request to its status.',
    boundary:
      'Card regions, limits and any verification requirements belong to the card program. Production availability is not implied by this website.',
    fits: 'The owner chooses Fund card in the dashboard, signs the wallet transactions and follows the in-app status of the operation.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'attest-verifier',
    oldSlug: 'jira-align',
    icon: 'attestation',
    title: 'Attest verifier',
    lead: 'Attestation checks the eligible environment, GPU evidence and measured model stack.',
    category: 'Attestation',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'The verifier checks the TDX quote, GPU evidence and allowlisted image or model measurements for sealed-lane nodes. The design requires fresh attestation for private jobs.',
    boundary:
      'Attestation is a defined execution boundary. The design discloses absent TDISP binding and physical attacks outside its scope. The sealed lane is in testing.',
    fits: 'Eligible confidential nodes attach environment and GPU evidence to the sealed job’s work record.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'receipt-verifier',
    oldSlug: 'linear',
    icon: 'receipt-verifier',
    title: 'Receipt verifier',
    lead: 'Signed job records are checked against node identity, billing and measured work.',
    category: 'Developer tools',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'The receipt verifier checks the COSE signature and the job-to-billing match. Measured token counts are compared with the gateway before metering records USDG earnings.',
    boundary:
      'A valid work receipt does not guarantee that an AI answer is correct. Canary jobs add a separate check.',
    fits: 'A completed node job emits a receipt. The verifier checks it before the record reaches metering and epoch building.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'stock-list',
    oldSlug: 'notion',
    icon: 'stock',
    title: 'Stock list',
    lead: 'The swap route offers a curated list of stock tokens that Spindle maintains.',
    category: 'Stock list',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'After a claim, the owner can swap USDG from their wallet for a token on the curated stock list. The quote presents price and impact, and the swap carries a minimum-output value. The owner approves and signs the swap in the wallet.',
    boundary:
      'Stock tokens have issuer-defined eligibility and no shareholder rights. Available liquidity can limit a swap or suggest a smaller amount. Only listed tokens are offered.',
    fits: 'Choose a listed stock token, review the quote and impact, then sign only if the proposed swap is suitable.',
    lifecycle: LIFECYCLE,
  },
  {
    slug: 'claim-service',
    oldSlug: 'salesforce',
    icon: 'claim',
    title: 'Claim service',
    lead: 'The claim service builds the proof that lets an owner claim USDG to their wallet.',
    category: 'Claims',
    records: 'Spec preview',
    flow: 'Specification',
    dataFlow:
      'A cumulative entitlement supports every claim. The service returns the epoch, cumulative amount and Merkle proof, and the owner submits the claim from their own wallet. Claims always pay the wallet, never a card or a swap directly.',
    boundary:
      'Earnings depend on buyer demand and verified completed work. The owner pays gas for the claim transaction. A claim cannot exceed the cumulative entitlement already posted on-chain.',
    fits: 'Claim in the dashboard, then optionally fund a card or swap to a stock token as separate wallet steps. This website does not send a transaction.',
    lifecycle: LIFECYCLE,
  },
];

export const COMPONENT_BY_SLUG = Object.fromEntries(COMPONENTS.map((c) => [c.slug, c]));
