// Generated from the old rendered pages (parity P8). Verbatim except approved rows of docs/plan/parity-text-exceptions.md. Kept page-local, outside content/, so the content copy-rule scans do not see the old wording.
export type ArchComponent = {
  slug: string;
  icon: string;
  title: string;
  lead: string;
  indexLead: string;
  dataFlow: string;
  boundary: string;
  fits: string;
  lifecycle: string;
  category: string;
  records: string;
  flow: string;
};

export const ARCH_COMPONENTS: ArchComponent[] = [
  {
    slug: 'node-registry',
    icon: 'registry',
    title: 'Node registry',
    lead: 'The node registry links node keys, GPU class and bonded identity on Robinhood Chain.',
    indexLead: 'The node registry links node keys, GPU class and bonded identity on Robinhood Chain.',
    dataFlow:
      'A node registers a key hash, GPU class, confidential-compute capability and attestation reference. The owner is a wallet address, with an ERC-8004 identity linked to the node.',
    boundary:
      'Stake and reputation support routing and accountability. Registration is not a guarantee of work, utilization or earnings.',
    fits: 'The Docker node agent benchmarks hardware and builds the registration request for the owner’s wallet.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Registry',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'api-gateway',
    icon: 'gateway',
    title: 'API gateway',
    lead: 'An OpenAI-compatible gateway accepts chat, embedding and image requests.',
    indexLead: 'An OpenAI-compatible gateway accepts chat, embedding and image requests.',
    dataFlow:
      'The API design supports chat completions, embeddings and images. Builders select the compute lane and use a USDG API balance or per-call x402 payment design.',
    boundary:
      'Sealed requests use the eligible confidential stack. Open-lane prompts are not private from the operator.',
    fits: 'Select the compute lane with the X-Spindle-Lane header. The gateway then routes the request to scheduling.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'API gateway',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'receipt-ledger',
    icon: 'ledger',
    title: 'Receipt ledger',
    lead: 'Verified work is recorded as USDG earning events before an hourly root is built.',
    indexLead: 'Verified work is recorded as USDG earning events before an hourly root is built.',
    dataFlow:
      'Signed receipts feed metering, which applies the rate card to verified work. The resulting USDG earning events link an owner, node and job to the cumulative entitlement used for claims.',
    boundary:
      'Receipts evidence work execution and metering; they do not prove that an AI output was correct. The ledger is a component of the specification, not a live balance on this preview.',
    fits: 'A verified receipt enters metering. The epoch builder gathers cumulative earnings and publishes the hourly Merkle root.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Work ledger',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'scheduler',
    icon: 'scheduler',
    title: 'Scheduler',
    lead: 'The scheduler matches accepted AI jobs to suitable nodes in the intended compute lane.',
    indexLead: 'The scheduler matches accepted AI jobs to suitable nodes in the intended compute lane.',
    dataFlow:
      'Routing uses compute lane, VRAM fit, stake weight, latency and reputation. The same scheduler design connects buyer demand to open-lane GPU supply; sealed-lane supply is in testing.',
    boundary:
      'Open-lane jobs must be non-sensitive. Sealed-lane work requires the eligible confidential-compute stack and attestation.',
    fits: 'A request arrives through the gateway. The scheduler checks its lane and requirements before assigning a suitable node.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Job routing',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'node-benchmark',
    icon: 'benchmark',
    title: 'Node benchmark',
    lead: 'The agent checks GPU class, available VRAM and confidential-compute capability.',
    indexLead: 'The agent checks GPU class, available VRAM and confidential-compute capability.',
    dataFlow:
      'Onboarding benchmarks the hardware and detects confidential-compute capability. Periodic benchmark and VRAM probes compare the node with its claimed GPU class.',
    boundary:
      'Consumer GPUs are not confidential. Only eligible attested hardware can serve sealed-lane jobs (in testing).',
    fits: 'Install the Docker agent on suitable hardware. Benchmark results help register the node and choose its compute lane.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Node hardware',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'claim-service',
    icon: 'claim',
    title: 'Claim service',
    lead: 'The claim service builds USDG claims; Stock Token and card steps are separate.',
    indexLead: 'The claim service builds USDG claims; Stock Token and card steps are separate.',
    dataFlow:
      'A shared cumulative entitlement supports all payout routes. The service builds a claim request and presents the route-specific quote, fees or delivery conditions before the owner signs.',
    boundary:
      'Card program terms and Stock Token eligibility govern their routes. Provider earnings depend on buyer demand and verified completed work.',
    fits: 'Choose a payout route and inspect its conditions in the intended dashboard flow. This preview does not send a transaction.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Registry',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'source-code',
    icon: 'github',
    title: 'GitHub',
    lead: 'Source and developer community details are coming soon. Explore the architecture preview.',
    indexLead: 'Source and developer community details are coming soon. Explore the architecture preview.',
    dataFlow:
      'GitHub access and repository links are coming soon. This page describes the planned developer-facing architecture rather than a connected GitHub integration or a published repository.',
    boundary: 'This preview does not connect to your GitHub account, read repositories or create issues.',
    fits: 'Use the dashboard and field notes to explore the specification. Repository access details will be published separately.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Developer tools',
    records: 'Coming soon',
    flow: 'Specification',
  },
  {
    slug: 'epoch-builder',
    icon: 'merkle',
    title: 'Epoch builder',
    lead: 'Cumulative earnings are grouped into an hourly Merkle tree and posted on-chain.',
    indexLead: 'Cumulative earnings are grouped into an hourly Merkle tree and posted on-chain.',
    dataFlow:
      'The epoch builder gathers cumulative USDG earnings by owner, builds the Merkle tree and publishes its root on Robinhood Chain. The proof supports the provider’s next claim.',
    boundary:
      'The contract design checks funding before accepting an epoch root. A shared claimed balance spans all payout routes.',
    fits: 'Verified work enters the ledger. Hourly epochs turn that cumulative record into a root and a retrievable proof.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Epoch records',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'attest-verifier',
    icon: 'attestation',
    title: 'Attest verifier',
    lead: 'Attestation checks the eligible environment, GPU evidence and measured model stack.',
    indexLead: 'Attestation checks the eligible environment, GPU evidence and measured model stack.',
    dataFlow:
      'The verifier checks the TDX quote, GPU evidence and allowlisted image or model measurements for sealed-lane nodes (in testing). The design requires fresh attestation for private jobs.',
    boundary:
      'Attestation is a defined execution boundary. The specification discloses absent TDISP binding and physical attacks outside its scope.',
    fits: 'Eligible confidential nodes attach environment and GPU evidence to the sealed job’s work record.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Attestation',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'receipt-verifier',
    icon: 'receipt-verifier',
    title: 'Receipt verifier',
    lead: 'Signed job records are checked against node identity, billing and measured work.',
    indexLead: 'Signed job records are checked against node identity, billing and measured work.',
    dataFlow:
      'The receipt verifier checks the COSE signature and the job-to-billing match. Measured token counts are compared with the gateway before metering records USDG earnings.',
    boundary:
      'A valid work receipt does not guarantee that an AI answer is correct. Canary jobs add a separate check in the design.',
    fits: 'A completed node job emits a receipt. The verifier checks it before the record reaches metering and epoch building.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Developer tools',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'card-adapter',
    icon: 'card-adapter',
    title: 'Card adapter',
    lead: 'The card adapter connects a signed claim to the third-party virtual card program.',
    indexLead: 'The card adapter connects a signed claim to the third-party virtual card program.',
    dataFlow:
      'The card step spends claimed USDG on-chain before issuance. An idempotent claim ID ties the provider request to delivery, and the design returns USDG entitlement after issuance failure.',
    boundary:
      'Card regions, limits and any verification requirements belong to the third-party program. Production availability is not implied by this preview.',
    fits: 'The owner chooses a card route, signs the request and follows the intended in-app delivery status.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Card routing',
    records: 'Spec preview',
    flow: 'Specification',
  },
  {
    slug: 'stock-list',
    icon: 'database',
    title: 'Canonical registry',
    lead: 'Stock claims use the canonical registry to check the selected Stock Token.',
    indexLead: 'Stock claims use the canonical registry to check the selected Stock Token.',
    dataFlow:
      'The stock route checks whether the selected token is canonical before a swap can execute. A quote presents price and impact, with a minimum-output value in the signed claim.',
    boundary:
      'Stock Tokens have issuer-defined eligibility and no shareholder rights. Available liquidity can limit the route or suggest a smaller claim.',
    fits: 'Choose a canonical Stock Token, review the quote and impact, then sign only if the proposed route is suitable.',
    lifecycle:
      'The same cumulative claimed balance prevents consuming one entitlement again through a different route.',
    category: 'Epoch records',
    records: 'Spec preview',
    flow: 'Specification',
  },
];

export type LegalDoc = {
  pill: string;
  title: string;
  date: string;
  sections: { heading: string; body: string; html?: string }[];
};

export const LEGAL_DOCS: Record<string, LegalDoc> = {
  'privacy-policy': {
    pill: 'Preview notice',
    title: 'Privacy Policy',
    date: 'Preview notice • October 14, 2026',
    sections: [
      {
        heading: 'Information in the design',
        body: 'The Spindle specification describes node keys, GPU capability, signed work receipts, earnings records and claim status. This website uses illustrative interface records to explain that design. It does not display a live personal account, earnings ledger or completed payout history.',
      },
      {
        heading: 'Preview interactions',
        body: 'Interactions in this preview explain the intended product flow. The technical documents do not establish a complete production website data inventory, analytics policy or retention schedule. Those details should be stated in the policy for the actual live service.',
      },
      {
        heading: 'Your choices',
        body: 'You can explore this preview without registering a live GPU node or submitting a payout transaction. Community channels on Telegram and X are coming soon. Browser controls can manage local site storage and embedded media behavior.',
      },
      {
        heading: 'Compute privacy boundaries',
        body: 'The sealed lane (in testing) is designed for confidential GPUs and attested execution, with encrypted prompts inside a defined TDX environment. The open lane is not private from the operator. Attestation has disclosed limits, and receipts evidence execution rather than output correctness.',
      },
      {
        heading: 'Third-party payout programs',
        body: 'The payout design includes a third-party virtual card program and canonical Stock Tokens. Their availability, regions, eligibility and program conditions apply independently of this website preview. No affiliation or completed production integration is implied.',
      },
      {
        heading: 'Future policy publication',
        body: 'A finalized privacy policy must describe the actual production service, its data practices and the applicable rights process. This page is a preview notice based on technical design material, not a claim that those production arrangements are complete.',
      },
      {
        heading: 'View verification',
        body: 'Spindle community channels are Telegram and X coming soon',
        html: 'Spindle community channels are <a href="/community#telegram">Telegram and X coming soon</a>',
      },
    ],
  },
  'cookie-policy': {
    pill: 'Preview notice',
    title: 'Cookie Policy',
    date: 'Preview notice • October 14, 2026',
    sections: [
      {
        heading: 'About this preview',
        body: 'This website is a Spindle design preview. It presents explanatory copy, illustrative UI and branded media based on the v1.1 specification. Production cookie settings and a complete cookie policy will be published with the applicable live service.',
      },
      {
        heading: 'Current website features',
        body: 'The visible preview includes navigation, animation and local interface controls. Community links are marked coming soon. It does not provide a production node account, live claims or a working payout program.',
      },
      {
        heading: 'Site storage',
        body: 'Cookie and storage behavior can depend on the website host and embedded media. This notice does not assert a completed analytics or consent implementation. Review the site’s current browser storage controls when evaluating the preview.',
      },
      {
        heading: 'Browser controls',
        body: 'You can manage cookies and local site storage through your browser settings. These controls may affect saved interface preferences and the behavior of hosted or embedded media.',
      },
      {
        heading: 'Third-party media',
        body: 'External hosts and media providers may have their own policies. A complete production inventory of services and storage behavior is not established by the Spindle technical specification.',
      },
      {
        heading: 'Future policy publication',
        body: 'Cookie practices and consent controls must reflect the actual production site. A finalized policy will accompany the applicable service rather than relying on this design-preview notice.',
      },
    ],
  },
  'terms-conditions': {
    pill: 'Preview terms notice',
    title: 'Terms & Conditions',
    date: 'Preview notice • October 14, 2026',
    sections: [
      {
        heading: 'About this specification preview',
        body: 'This website presents Spindle’s v1.1 compute-network specification and illustrative interface flows. It is a product design preview. It does not provide live GPU registration, buyer-funded jobs, wallet transactions or issued cards.',
      },
      {
        heading: 'Available preview features',
        body: 'You can browse the explanatory pages and interact with local interface demonstrations. Actions labelled coming soon do not create an account, join a community or submit a transaction. Production access details will be published separately.',
      },
      {
        heading: 'Wallet and node design',
        body: 'The intended product uses node keys and wallet signatures. Wallet signatures, node registration and payout authorizations belong to the production design and are not performed by the illustrative controls on this site.',
      },
      {
        heading: 'Specification changes',
        body: 'The specification includes staged build lanes and may change before production. The availability of a particular compute lane or payout route depends on implementation, eligible hardware, liquidity and third-party program conditions.',
      },
      {
        heading: 'Known design limits',
        body: 'Earnings depend on buyer demand and verified completed work. Open-lane compute is not confidential. Stock Tokens have issuer eligibility conditions and no shareholder rights. Card regions, limits and verification requirements are set by their program.',
      },
      {
        heading: 'Production terms',
        body: 'Production service terms and applicable policies must be provided for the actual live service. This preview explains the architecture and its limits without promising production availability.',
      },
    ],
  },
};
