import type { Cta, Feature, PageMeta, Step } from '../../components/marketing/types';
import { CTA_DASHBOARD } from './home';

export const verificationMeta: PageMeta = {
  title: 'Verification: receipts, roots and limits | Spindle',
  description:
    'Signed COSE receipts, hourly Merkle roots, a 1h claim delay with guardian veto, canary checks and the honest limits of what a receipt proves.',
  path: '/verification',
};

export const verificationHero = {
  eyebrow: 'Verification',
  title: 'The work. The evidence.',
  lead: 'Every job links its node, metering and execution evidence to a signed receipt. Follow that record into an hourly Merkle root on Robinhood Chain.',
  quote: 'Compute becomes a signed receipt. The receipt becomes a claim. You choose what happens next.',
  ctas: [CTA_DASHBOARD] as Cta[],
};

export const evidenceSteps = {
  eyebrow: 'Verification / v1.1',
  title: 'Follow the evidence.',
  lead: 'From a completed request to a signed work record.',
  steps: [
    {
      icon: 'receipts',
      title: 'Signed at the node',
      body: 'A COSE receipt binds the job, node key and metered work. The verifier checks the signature and its billing match.',
    },
    {
      icon: 'attestation',
      title: 'Attest the sealed lane (in testing)',
      body: 'Eligible GPUs attach a TDX quote, measurements and GPU evidence. Sealed-lane attestation must be no more than one hour old.',
    },
    {
      icon: 'merkle',
      title: 'Publish the hourly root',
      body: 'Verified work enters the ledger. The epoch builder publishes a cumulative Merkle tree and posts its root on Robinhood Chain.',
    },
  ] satisfies Step[],
};

export const safeguards = {
  eyebrow: 'Before money moves',
  title: 'Safeguards on every claim',
  items: [
    {
      icon: 'epoch',
      title: '1h claim delay',
      body: 'Each posted root becomes claimable one hour later, with a per-epoch cap on what it can pay out.',
    },
    {
      icon: 'shield',
      title: 'Guardian veto',
      body: 'During the delay a guardian can veto a root that fails review. The contracts have no owner, upgrade or pause.',
    },
    {
      icon: 'benchmark',
      title: 'Canaries and probes',
      body: 'Known-answer canary jobs and node probes check that nodes run the model they claim to run.',
    },
  ] satisfies Feature[],
};

export const limits = {
  eyebrow: 'Honest limits',
  title: 'What verification does not prove',
  items: [
    'A receipt proves execution on the measured stack. It does not prove the output was correct.',
    'Open-lane work is visible to the node operator.',
    'Probe results are self-reported by the node; canaries reduce, but do not remove, the chance of a dishonest node.',
    'Sealed-lane attestation is in testing and is not yet independently verified on production hardware.',
    'Consumer GPUs are not confidential.',
  ],
};

export const community = {
  items: [
    { icon: 'telegram', label: 'Telegram' },
    { icon: 'x', label: 'X' },
  ],
  note: 'Coming soon',
};
