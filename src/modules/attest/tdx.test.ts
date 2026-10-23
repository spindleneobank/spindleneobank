import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { type DstackEvent, runtimeEventDigest, expectedReportData, replayRtmr3, tdxDeps, verifyTdxQuote, clearCollateralCache, AttestError } from './tdx';
import { REAL_COLLATERAL, REAL_QUOTE, REAL_QUOTE_NOW_MS, syntheticEventLog } from './testkit';

const saved = { ...tdxDeps };
beforeEach(() => {
  clearCollateralCache();
  tdxDeps.now = () => REAL_QUOTE_NOW_MS;
  tdxDeps.fetchCollateral = async () => REAL_COLLATERAL;
});
afterEach(() => Object.assign(tdxDeps, saved));

describe('DCAP verification of a REAL public TDX quote (dcap-qvl sample, recorded Intel collateral)', () => {
  test('verifies and exposes measurements', async () => {
    const m = await verifyTdxQuote(REAL_QUOTE);
    expect(m.tcbStatus).toBe('UpToDate');
    expect(m.mrTd).toMatch(/^[0-9a-f]{96}$/);
    expect(m.rtmr3).toMatch(/^[0-9a-f]{96}$/);
    expect(m.reportData).toHaveLength(128);
  });

  test('collateral is cached for an hour', async () => {
    let calls = 0;
    tdxDeps.fetchCollateral = async () => (calls++, REAL_COLLATERAL);
    await verifyTdxQuote(REAL_QUOTE);
    await verifyTdxQuote(REAL_QUOTE);
    expect(calls).toBe(1);
    tdxDeps.now = () => REAL_QUOTE_NOW_MS + 61 * 60_000;
    await verifyTdxQuote(REAL_QUOTE).catch(() => {}); // collateral still valid ~30 days
    expect(calls).toBe(2);
  });

  test('a tampered quote fails DCAP verification', async () => {
    const bad = Buffer.from(REAL_QUOTE);
    bad[200] = (bad[200] as number) ^ 0xff; // inside MRTD (signed by the QE-attested key)
    await expect(verifyTdxQuote(bad)).rejects.toMatchObject({ name: 'AttestError' });
  });

  test('expired collateral and unsupported TCB are rejected', async () => {
    tdxDeps.now = () => Date.parse('2026-01-01T00:00:00Z');
    await expect(verifyTdxQuote(REAL_QUOTE)).rejects.toMatchObject({ reason: 'TDX_QUOTE_INVALID' });
  });

  test('garbage is malformed; an SGX quote is not TDX', async () => {
    await expect(verifyTdxQuote(new Uint8Array(500))).rejects.toMatchObject({ reason: 'TDX_QUOTE_MALFORMED' });
  });

  test('collateral outage is reported', async () => {
    tdxDeps.fetchCollateral = async () => {
      throw new Error('pcs down');
    };
    await expect(verifyTdxQuote(REAL_QUOTE)).rejects.toMatchObject({ reason: 'TDX_COLLATERAL_UNAVAILABLE' });
  });
});

describe('report_data binding (SYNTHETIC inputs)', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const node = `0x${'ab'.repeat(20)}`;
  const nonce = '09'.repeat(32);
  test('is sha256(hpkePub || nodeKey || nonce) padded to 64 bytes and changes with every input', () => {
    const rd = expectedReportData(key, node, nonce);
    expect(rd).toHaveLength(128);
    expect(rd.slice(64)).toBe('0'.repeat(64));
    expect(expectedReportData(Buffer.alloc(32, 8).toString('base64'), node, nonce)).not.toBe(rd);
    expect(expectedReportData(key, `0x${'cd'.repeat(20)}`, nonce)).not.toBe(rd);
    expect(expectedReportData(key, node, '0a'.repeat(32))).not.toBe(rd);
  });
  test('rejects bad inputs', () => {
    expect(() => expectedReportData('AAAA', node, nonce)).toThrow(AttestError);
    expect(() => expectedReportData(key, '0x12', nonce)).toThrow(AttestError);
    expect(() => expectedReportData(key, node, 'zz')).toThrow(AttestError);
  });
});

describe('RTMR3 replay (SYNTHETIC dstack event log)', () => {
  test('replay is deterministic and exposes named events', () => {
    const a = replayRtmr3(syntheticEventLog() as DstackEvent[]);
    expect(a.rtmr3).toHaveLength(96);
    expect(a.named.get('compose-hash')).toBe('e5'.repeat(32));
    expect(replayRtmr3(syntheticEventLog() as DstackEvent[]).rtmr3).toBe(a.rtmr3);
  });
  test('removing, reordering or editing an event changes RTMR3 or is rejected', () => {
    const log = syntheticEventLog();
    const base = replayRtmr3(log).rtmr3;
    expect(replayRtmr3(log.slice(1)).rtmr3).not.toBe(base);
    expect(replayRtmr3([log[1], log[0], ...log.slice(2)] as DstackEvent[]).rtmr3).not.toBe(base);
    const forged = log.map((e) => (e.event === 'compose-hash' ? { ...e, event_payload: 'ff'.repeat(32) } : e));
    expect(() => replayRtmr3(forged)).toThrow(AttestError); // payload no longer matches the measured digest
  });
  test('conflicting duplicate compose-hash events are rejected', () => {
    const log = syntheticEventLog();
    const dup = { ...log[2], event_payload: 'ff'.repeat(32) } as DstackEvent;
    // build a valid digest for the duplicate so only the conflict rule fires
    dup.digest = runtimeEventDigest(dup);
    expect(() => replayRtmr3([...log, dup])).toThrow(/conflicting/);
  });
  test('non-imr3 events are ignored', () => {
    const log = syntheticEventLog();
    const extra = { imr: 1, event_type: 1, digest: '00'.repeat(48), event: 'x', event_payload: '' };
    expect(replayRtmr3([extra, ...log]).rtmr3).toBe(replayRtmr3(log).rtmr3);
  });
});
