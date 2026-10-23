import type { MockFixtures } from '../mock';
import { authFixtures } from './auth';
import { buyerFixtures } from './buyer';
import { cardOperationFixtures } from './card-operations';
import { cardFixtures } from './cards';
import { claimProofFixtures } from './claim';
import { claimFixtures } from './claims';
import { earningsFixtures } from './earnings';
import { meFixtures } from './me';
import { modelFixtures } from './models';
import { networkFixtures } from './network';
import { nodeFixtures } from './nodes';
import { receiptFixtures } from './receipts';
import { relayFixtures } from './relay';
import { stockFixtures } from './stocks';
import { x402Fixtures } from './x402';

/** Later F-tasks add their own `*.ts` and spread it here. Keys are `METHOD /v1/path/:param`. */
export const fixtures: MockFixtures = {
  ...authFixtures,
  ...meFixtures,
  ...networkFixtures,
  ...earningsFixtures,
  ...receiptFixtures,
  ...claimFixtures,
  ...buyerFixtures,
  ...nodeFixtures,
  ...cardFixtures,
  ...modelFixtures,
  ...x402Fixtures,
  ...claimProofFixtures,
  ...stockFixtures,
  ...cardOperationFixtures,
  ...relayFixtures,
};
