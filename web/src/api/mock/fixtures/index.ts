import type { MockFixtures } from '../mock';
import { authFixtures } from './auth';
import { meFixtures } from './me';
import { networkFixtures } from './network';

/** Later F-tasks add their own `*.ts` and spread it here. Keys are `METHOD /v1/path/:param`. */
export const fixtures: MockFixtures = {
  ...authFixtures,
  ...meFixtures,
  ...networkFixtures,
};
