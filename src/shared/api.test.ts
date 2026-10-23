import { expect, test } from 'bun:test';
import { verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as api from './api';
import { nodeBindingTypedData } from './binding';
import { ErrorCode } from './enums';

test('api schemas', () => {
  expect(api.ApiError.safeParse({ error: { code: 'NOT_FOUND', message: 'x' } }).success).toBe(true);
  expect(api.ApiError.safeParse({ error: { code: 'NOPE', message: 'x' } }).success).toBe(false);
  const P = api.Paginated(api.GetAuthNonceRes);
  expect(P.safeParse({ items: [{ nonce: 'a' }], nextCursor: null }).success).toBe(true);
  expect(api.GetEarningsSummaryRes.shape.totalEarnedMicros.safeParse(1.5).success).toBe(false);
  expect(api.GetEarningsSeriesReq.parse({}).range).toBe('7d');
  expect(api.PageQuery.parse({ limit: '10' }).limit).toBe(10);
  expect(ErrorCode.length).toBeGreaterThan(14);
});

test('node binding typed data (both call styles)', async () => {
  const acct = privateKeyToAccount(generatePrivateKey());
  const registry = '0x00000000000000000000000000000000000000bb' as const;
  const m = {
    owner: acct.address,
    nodeKey: acct.address,
    gpuClass: 2,
    ccCapable: false,
    deadline: 1_900_000_000,
  };
  const a = nodeBindingTypedData({ registry, chainId: 4663, ...m });
  const b = nodeBindingTypedData({ registry, chainId: 4663 }, m);
  expect(b).toEqual(a);
  const signature = await acct.signTypedData(a);
  expect(await verifyTypedData({ ...a, address: acct.address, signature })).toBe(true);
});
