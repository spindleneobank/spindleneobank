import {
  type Collateral,
  verify as dcapVerify,
  getCollateral,
  Quote,
  type VerifiedReport,
} from '@phala/dcap-qvl';
import { AttestError, sha256 } from '../../shared/dstack';
import { attestSettings } from './settings';

export {
  AttestError,
  DSTACK_RUNTIME_EVENT_TYPE,
  type DstackEvent,
  expectedReportData,
  parseEventLog,
  replayRtmr3,
  runtimeEventDigest,
  sha256,
} from '../../shared/dstack';

/** Test seams for the network and the clock. Defaults: Intel PCS collateral, the dcap-qvl pure-JS verifier. */
export const tdxDeps = {
  fetchCollateral: (quote: Uint8Array): Promise<Collateral> => getCollateral(attestSettings.pcsUrl, quote),
  verify: (quote: Uint8Array, collateral: Collateral, nowSecs: number): VerifiedReport =>
    dcapVerify(quote, collateral, nowSecs),
  now: (): number => Date.now(),
};

const hex = (u: Uint8Array): string => Buffer.from(u).toString('hex');

// ---- collateral cache (1 h) -----------------------------------------------------------------------------

const collateralCache = new Map<string, { at: number; value: Collateral }>();
export const clearCollateralCache = (): void => collateralCache.clear();

/** Collateral is per platform (PCK certificate), so the cache key is the hash of the quote's cert chain. */
async function collateralFor(quoteBytes: Uint8Array, quote: Quote): Promise<Collateral> {
  const key = hex(sha256(quote.rawCertChain()));
  const hit = collateralCache.get(key);
  if (hit && tdxDeps.now() - hit.at < attestSettings.collateralTtlMs) return hit.value;
  const value = await tdxDeps.fetchCollateral(quoteBytes);
  collateralCache.set(key, { at: tdxDeps.now(), value });
  return value;
}

// ---- quote verification ---------------------------------------------------------------------------------

export interface TdxMeasurements {
  mrTd: string;
  rtmr0: string;
  rtmr1: string;
  rtmr2: string;
  rtmr3: string;
  /** 64 bytes hex */
  reportData: string;
  tcbStatus: string;
  advisoryIds: string[];
}

/**
 * DCAP-verifies a TDX quote (signature chain to the Intel root, QE identity, TCB info, CRLs) and returns the
 * measurements. Throws AttestError('TDX_*').
 */
export async function verifyTdxQuote(quoteBytes: Uint8Array): Promise<TdxMeasurements> {
  let quote: Quote;
  try {
    quote = Quote.parse(quoteBytes);
  } catch (e) {
    throw new AttestError('TDX_QUOTE_MALFORMED', String(e));
  }
  if (quote.header.isSgx()) throw new AttestError('TDX_QUOTE_NOT_TDX', 'quote is an SGX quote');
  let collateral: Collateral;
  try {
    collateral = await collateralFor(quoteBytes, quote);
  } catch (e) {
    throw new AttestError('TDX_COLLATERAL_UNAVAILABLE', String(e));
  }
  let r: VerifiedReport;
  try {
    r = tdxDeps.verify(quoteBytes, collateral, Math.floor(tdxDeps.now() / 1000));
  } catch (e) {
    throw new AttestError('TDX_QUOTE_INVALID', String(e));
  }
  if (!attestSettings.allowedTcb.includes(r.status)) {
    throw new AttestError('TDX_TCB_STATUS', `TCB status ${r.status} is not allowed`);
  }
  const td = r.report.asTd10() ?? r.report.asTd15()?.base ?? r.report.asTd15Ex()?.base.base;
  if (!td) throw new AttestError('TDX_QUOTE_NOT_TDX', 'no TD report in quote');
  if (((td.tdAttributes[0] ?? 0) & 1) !== 0) throw new AttestError('TDX_DEBUG', 'TD debug attribute is set');
  return {
    mrTd: hex(td.mrTd),
    rtmr0: hex(td.rtMr0),
    rtmr1: hex(td.rtMr1),
    rtmr2: hex(td.rtMr2),
    rtmr3: hex(td.rtMr3),
    reportData: hex(td.reportData),
    tcbStatus: r.status,
    advisoryIds: r.advisory_ids,
  };
}
