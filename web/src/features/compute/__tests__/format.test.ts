import { describe, expect, it } from 'vitest';
import {
  engineAllowed,
  fmtSpdl,
  isPairCode,
  normalizePairCode,
  parseSpdl,
  readCanary,
  readProbe,
  stakeState,
  walletBlock,
} from '../format';

describe('compute format', () => {
  it('blocks vLLM on macOS only', () => {
    expect(engineAllowed('macos', 'vllm')).toBe(false);
    expect(engineAllowed('macos', 'ollama')).toBe(true);
    expect(engineAllowed('linux', 'vllm')).toBe(true);
  });
  it('normalizes pairing codes', () => {
    expect(normalizePairCode('abcd1234')).toBe('ABCD-1234');
    expect(normalizePairCode(' ab-cd ')).toBe('ABCD');
    expect(isPairCode('ABCD-1234')).toBe(true);
    expect(isPairCode('ABCD1234')).toBe(false);
  });
  it('parses SPDL with 18 decimals and rejects junk', () => {
    expect(parseSpdl('1')).toBe(10n ** 18n);
    expect(parseSpdl('0.5')).toBe(5n * 10n ** 17n);
    expect(parseSpdl('0')).toBeNull();
    expect(parseSpdl('-1')).toBeNull();
    expect(parseSpdl('1e3')).toBeNull();
    expect(parseSpdl('')).toBeNull();
    expect(parseSpdl('0.1234567890123456789')).toBeNull();
  });
  it('formats SPDL', () => {
    expect(fmtSpdl(1500n * 10n ** 18n)).toBe('1,500');
    expect(fmtSpdl(5n * 10n ** 17n)).toBe('0.5');
    expect(fmtSpdl('0')).toBe('0');
  });
  it('derives stake state', () => {
    const min = (10n ** 18n).toString();
    expect(stakeState({ registered: false, stake: { active: '0', pending: '0', unlockAt: null, min } })).toBe(
      'unregistered',
    );
    expect(stakeState({ registered: true, stake: { active: '0', pending: '0', unlockAt: null, min } })).toBe(
      'unstaked',
    );
    expect(stakeState({ registered: true, stake: { active: '5', pending: '0', unlockAt: null, min } })).toBe(
      'below-min',
    );
    expect(stakeState({ registered: true, stake: { active: min, pending: '0', unlockAt: null, min } })).toBe(
      'staked',
    );
  });
  it('gates the wallet', () => {
    const base = { expectedChainId: 4663, sessionAddress: '0xAbC', isConnected: true };
    expect(walletBlock({ ...base, isConnected: false })).toBe('no-wallet');
    expect(walletBlock({ ...base, address: '0xdef', chainId: 4663 })).toBe('wrong-account');
    expect(walletBlock({ ...base, address: '0xabc', chainId: 1 })).toBe('wrong-chain');
    expect(walletBlock({ ...base, address: '0xabc', chainId: 4663 })).toBeNull();
  });
  it('reads loose probe and canary rows', () => {
    expect(readProbe({ classOk: true, tokPerSec: '41.2' })?.note).toBe('41.2 tok/s');
    expect(readProbe(null)).toBeNull();
    expect(readCanary({ pass: false, kind: 'exact' })).toEqual({ ok: false, at: undefined, note: 'exact' });
  });
});
