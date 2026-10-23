export type LegalDoc = {
  slug: 'privacy-policy' | 'cookie-policy' | 'terms-conditions';
  title: string;
  eyebrow: string;
  date: string;
  /** Sections flagged for legal review before launch. */
  review: boolean;
  sections: { heading: string; body: string }[];
};

const DATE = 'Preview notice • October 14, 2026';

export const LEGAL: LegalDoc[] = [
  {
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    eyebrow: 'Preview notice',
    date: DATE,
    review: true,
    sections: [
      {
        heading: 'Information in the design',
        body: 'The Spindle design describes node keys, GPU capability, signed work receipts, earnings records and claim status. This website uses illustrative interface records to explain that design. Unless you connect a wallet to the dashboard, it does not display a personal account, earnings ledger or payout history.',
      },
      {
        heading: 'Preview interactions',
        body: 'Interactions on the marketing pages explain the intended product flow. The technical documents do not establish a complete production website data inventory, analytics policy or retention schedule. Those details should be stated in the policy for the live service.',
      },
      {
        heading: 'Your choices',
        body: 'You can explore the marketing pages without registering a node or submitting a transaction. Community channels on Telegram and X are coming soon. Browser controls can manage local site storage and embedded media behavior.',
      },
      {
        heading: 'Compute privacy boundaries',
        body: 'The sealed lane is designed for eligible confidential GPUs and attested execution, with encrypted prompts inside a defined TDX environment, and is in testing. The open lane is not private from the operator. Attestation has disclosed limits, and receipts evidence execution rather than output correctness.',
      },
      {
        heading: 'Third-party payout programs',
        body: 'The payout design includes a third-party card program and stock tokens. Their availability, regions, eligibility and program conditions apply independently of this website. No endorsement or completed production integration is implied.',
      },
      {
        heading: 'Future policy publication',
        body: 'A finalized privacy policy must describe the actual production service, its data practices and the applicable rights process. This page is a preview notice based on technical design material, not a claim that those production arrangements are complete.',
      },
    ],
  },
  {
    slug: 'cookie-policy',
    title: 'Cookie Policy',
    eyebrow: 'Preview notice',
    date: DATE,
    review: true,
    sections: [
      {
        heading: 'About this site',
        body: 'This website presents Spindle’s design, illustrative interface and branded media. Production cookie settings and a complete cookie policy will be published with the applicable live service.',
      },
      {
        heading: 'Current website features',
        body: 'The marketing pages include navigation, animation and local interface controls. Community links are marked coming soon. The dashboard uses a session cookie after you sign in with a wallet.',
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
        body: 'External hosts and media providers may have their own policies. A complete production inventory of services and storage behavior is not established by the Spindle technical documents.',
      },
      {
        heading: 'Future policy publication',
        body: 'Cookie practices and consent controls must reflect the actual production site. A finalized policy will accompany the applicable service rather than relying on this preview notice.',
      },
    ],
  },
  {
    slug: 'terms-conditions',
    title: 'Terms & Conditions',
    eyebrow: 'Preview terms notice',
    date: DATE,
    review: true,
    sections: [
      {
        heading: 'About this preview',
        body: 'This website presents Spindle’s compute-network design and illustrative interface flows. It is a product preview. It does not by itself provide GPU registration, buyer-funded jobs, wallet transactions or issued cards.',
      },
      {
        heading: 'Available preview features',
        body: 'You can browse the explanatory pages and interact with local interface demonstrations. Actions labelled coming soon do not create an account, join a community or submit a transaction. Production access details will be published separately.',
      },
      {
        heading: 'Wallet and node design',
        body: 'The intended product uses node keys and owner wallets. Wallet signatures, node registration and claim or funding transactions belong to the dashboard and are never performed by the illustrative controls on the marketing pages.',
      },
      {
        heading: 'Design changes',
        body: 'The design includes staged build lanes and may change before production. The availability of a particular compute lane or payout step depends on implementation, eligible hardware, liquidity and third-party program conditions. The sealed lane is in testing.',
      },
      {
        heading: 'Known design limits',
        body: 'Earnings depend on buyer demand and verified completed work. Open-lane compute is not confidential. Stock tokens have issuer eligibility conditions and no shareholder rights. Card regions, limits and verification requirements are set by the card program.',
      },
      {
        heading: 'Production terms',
        body: 'Production service terms and applicable policies must be provided for the actual live service. This preview explains the architecture and its limits without promising production availability.',
      },
    ],
  },
];

export const LEGAL_BY_SLUG = Object.fromEntries(LEGAL.map((d) => [d.slug, d]));
