import { describe, expect, it } from 'vitest';
import { parseEnv } from '../env.schema';

const base = {
  VITE_API_URL: 'http://127.0.0.1:7200',
  VITE_APP_URL: 'http://127.0.0.1:7000',
  VITE_RPC_URL: 'http://127.0.0.1:7245',
  VITE_REOWN_PROJECT_ID: 'x',
  VITE_EXPLORER_URL: 'https://e.test',
  VITE_USDG_ADDRESS: '0x0000000000000000000000000000000000000001',
  VITE_PERMIT2_ADDRESS: '0x0000000000000000000000000000000000000002',
  VITE_REGISTRY_ADDRESS: '0x0000000000000000000000000000000000000003',
  VITE_STAKING_ADDRESS: '0x0000000000000000000000000000000000000004',
  VITE_CLAIMS_ADDRESS: '0x0000000000000000000000000000000000000005',
  VITE_VAULT_ADDRESS: '0x0000000000000000000000000000000000000006',
  VITE_SPDL_ADDRESS: '0x0000000000000000000000000000000000000007',
  VITE_NODE_IMAGE: 'spindle/node',
};

describe('parseEnv', () => {
  it('accepts a valid env and defaults chain 4663 / mock off', () => {
    const e = parseEnv(base);
    expect(e.chainId).toBe(4663);
    expect(e.mock).toBe(false);
  });
  it('rejects a missing VITE_API_URL', () => {
    const { VITE_API_URL: _omit, ...rest } = base;
    expect(() => parseEnv(rest)).toThrow(/VITE_API_URL/);
  });
  it('rejects bad addresses and mock flag', () => {
    expect(() => parseEnv({ ...base, VITE_USDG_ADDRESS: 'nope' })).toThrow(/VITE_USDG_ADDRESS/);
    expect(() => parseEnv({ ...base, VITE_API_MOCK: 'yes' })).toThrow(/VITE_API_MOCK/);
  });
});
