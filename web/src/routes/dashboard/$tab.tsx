import { createFileRoute } from '@tanstack/react-router';
import { TabView } from '../../dashboard/TabView';

export const PAYMENT_ACTIONS = ['claim', 'card', 'swap', 'split'] as const;
export type PaymentAction = (typeof PAYMENT_ACTIONS)[number];

/** `?action=` selects the Payments sub-tab (F1/F3), `?op=` resumes a card operation. Unknown values drop. */
export const Route = createFileRoute('/dashboard/$tab')({
  // Other keys (e.g. the dev-only `?mock=`/`?scenario=`) pass through so in-app navigation keeps them.
  validateSearch: (s: Record<string, unknown>): { action?: PaymentAction; op?: string } => ({
    ...s,
    action: PAYMENT_ACTIONS.find((a) => a === s.action),
    op: typeof s.op === 'string' && /^[\w-]{1,64}$/.test(s.op) ? s.op : undefined,
  }),
  component: TabView,
});
