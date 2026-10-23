import type { MockFixtures } from '../mock';
import { authFixtures } from './auth';
import { claimFixtures } from './claims';
import { earningsFixtures } from './earnings';
import { meFixtures } from './me';
import { modelFixtures } from './models';
import { networkFixtures } from './network';
import { receiptFixtures } from './receipts';
import { x402Fixtures } from './x402';

/** Later F-tasks add their own `*.ts` and spread it here. Keys are `METHOD /v1/path/:param`. */
export const fixtures: MockFixtures = {
  ...authFixtures,
  ...meFixtures,
  ...networkFixtures,
  ...earningsFixtures,
  ...receiptFixtures,
  ...claimFixtures,
  ...modelFixtures,
  ...x402Fixtures,
};
