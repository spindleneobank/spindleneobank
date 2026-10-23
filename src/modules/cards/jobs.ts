import type { JobModule } from '../../lib/modules';
import { pollRelayOrders } from '../relay/orders';
import { runCardsMaintenance } from './reconcile';
import { assertRelayModeSafe } from './settings';

/** Reconcile + Relay polling every 10 s under one Redis lock. `cards:reconcile` is also admin-runnable. */
export const cardsJobs: JobModule = async (ctx) => {
  assertRelayModeSafe();
  ctx.process('cards', 'cards:reconcile', () => runCardsMaintenance([pollRelayOrders]));
  await ctx.schedule('cards', 'cards:reconcile', 10_000);
};

export default cardsJobs;
