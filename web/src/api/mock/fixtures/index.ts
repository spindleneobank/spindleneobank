import type { MockFixtures } from '../mock';
import { authFixtures } from './auth';
import { cardOperationFixtures } from './card-operations';
import { claimProofFixtures } from './claim';
import { claimFixtures } from './claims';
import { earningsFixtures } from './earnings';
import { meFixtures } from './me';
import { networkFixtures } from './network';
import { receiptFixtures } from './receipts';
import { relayFixtures } from './relay';
import { stockFixtures } from './stocks';

/** Later F-tasks add their own `*.ts` and spread it here. Keys are `METHOD /v1/path/:param`. */
export const fixtures: MockFixtures = {
  ...authFixtures,
  ...meFixtures,
  ...networkFixtures,
  ...earningsFixtures,
  ...receiptFixtures,
  ...claimFixtures,
  ...claimProofFixtures,
  ...stockFixtures,
  ...cardOperationFixtures,
  ...relayFixtures,
};
