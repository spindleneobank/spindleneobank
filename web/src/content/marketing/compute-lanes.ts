import type { Cta, PageMeta } from '../../components/marketing/types';
import { CTA_API, CTA_DASHBOARD } from './home';

export const lanesMeta: PageMeta = {
  title: 'Compute lanes: open and sealed (in testing) | Spindle',
  description:
    'Two lanes, one network. The open lane serves non-sensitive public-model work and is visible to the operator. The sealed lane for confidential execution is in testing.',
  path: '/compute-lanes',
};

export const lanesHero = {
  eyebrow: 'Compute lanes',
  title: 'Two lanes. One network.',
  lead: 'Match each workload to the right hardware. The open lane serves public-model jobs, embeddings, evaluations and image generation. The sealed lane, for sensitive prompts, is in testing.',
  ctas: [CTA_API, CTA_DASHBOARD] as Cta[],
};

export const sealedLane = {
  id: 'sealed',
  badge: 'In testing',
  eyebrow: 'Sealed lane',
  title: 'Confidential GPU execution',
  body: 'Built for sensitive prompts on eligible confidential-computing hardware. It is in testing: invited testers with the hardware are verifying it, and it is not offered for production traffic yet.',
  icon: 'sealed',
  stat: '01',
  statLabel: 'Compute design',
  details: [
    'TDX confidential environment',
    'Encrypted prompts through OHTTP',
    'Signed COSE job receipts',
    'Eligible GPU attestation',
    'Compatible inference API',
  ],
  warning:
    'Consumer GPUs cannot provide confidential execution. Only eligible attested hardware can serve the sealed lane.',
};

export const openLane = {
  id: 'open',
  badge: 'Available design',
  eyebrow: 'Open lane',
  title: 'Flexible GPU capacity',
  body: 'For non-sensitive workloads. The node operator can see requests and responses, so this lane is not private from the operator.',
  icon: 'open',
  stat: '02',
  statLabel: 'Compute design',
  details: [
    'RTX 3090 / 4090 / 5090 class',
    'Public-model batch inference',
    'Embeddings, evaluations and images',
    'Non-sensitive workloads only',
    'Workload-aware scheduler',
  ],
  warning: 'Do not send secrets, personal data or confidential prompts through the open lane.',
};

export const sharedProof = {
  stat: '1h',
  statLabel: 'Receipt epoch',
  badge: 'Both lanes',
  eyebrow: 'Shared proof',
  title: 'Evidence across both lanes',
  items: [
    'Node-key receipt signatures',
    'Job-to-billing verification',
    'Hourly cumulative Merkle roots',
    'Registered node identity',
    'Reputation-guided routing',
    'Optional stake for routing priority',
  ],
  footer: 'One verified work ledger. Evidence before accounting.',
};

export const compare = {
  eyebrow: 'Compare the design',
  title: 'Sealed and open, side by side',
  columns: ['', 'Sealed lane (in testing)', 'Open lane', 'Shared proof'],
  groups: [
    {
      title: 'Hardware & workload',
      rows: [
        ['Workload', 'Sensitive prompts', 'Non-sensitive, public models', '-'],
        [
          'GPU class',
          'Eligible confidential-computing GPUs (TDX)',
          'RTX 3090 / 4090 / 5090 class and up',
          'Hardware capability checks',
        ],
        ['Private from the operator', 'Designed to be, with attestation', 'No', '-'],
      ],
    },
    {
      title: 'Receipts & execution',
      rows: [
        ['Evidence', 'Signed receipt plus attestation', 'Signed receipt', 'Receipts prove execution'],
        ['Metering', 'Job / tokens', 'GPU-hour or job / tokens', 'Job-to-billing verification'],
        ['Root cadence', '1 hour', '1 hour', 'Hourly cumulative Merkle roots'],
      ],
    },
    {
      title: 'Network integrity',
      rows: [
        ['Status', 'In testing', 'Open design', 'One verified work ledger'],
        ['Node identity', 'Registered node', 'Registered node', 'Reputation-guided routing'],
        [
          'Output correctness',
          'Not proven by receipts',
          'Not proven by receipts',
          'Canaries and probes reduce risk',
        ],
      ],
    },
  ],
};
