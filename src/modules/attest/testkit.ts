/**
 * SYNTHETIC attestation fixtures for tests. Nothing here comes from real TDX or NVIDIA hardware:
 *  - the quote bytes are the REAL public dcap-qvl sample (so Quote.parse works) but `tdxDeps.verify` is stubbed to
 *    report the measurements and report_data the test wants;
 *  - the NRAS answer is a JWT signed by a locally generated ES384 key, served through a local key resolver.
 * Real DCAP verification of the real sample quote is covered separately in tdx.test.ts.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Collateral, VerifiedReport } from '@phala/dcap-qvl';
import { generateKeyPair as joseKeyPair, SignJWT } from 'jose';
import { canonicalJson } from '../../shared/canonical-json';
import type { AttestationBundle } from '../../shared/node-protocol';
import { generateKeyPair } from '../../shared/sealed';
import { nvidiaDeps } from './nvidia';
import { attestSettings, resetAllowlist } from './settings';
import { clearCollateralCache, DSTACK_RUNTIME_EVENT_TYPE, expectedReportData, replayRtmr3, runtimeEventDigest, tdxDeps } from './tdx';

const fx = (f: string) => new URL(`./fixtures/${f}`, import.meta.url).pathname;
export const REAL_QUOTE = readFileSync(fx('dcap-qvl-tdx_quote.bin'));
export const REAL_COLLATERAL = JSON.parse(readFileSync(fx('dcap-qvl-tdx_quote_collateral.json'), 'utf8')) as Collateral;
/** The collateral of the real sample is valid around this time. */
export const REAL_QUOTE_NOW_MS = Date.parse('2025-06-25T00:00:00Z');

export const SYN = {
  mrTd: 'a1'.repeat(48),
  rtmr0: 'b2'.repeat(48),
  rtmr1: 'c3'.repeat(48),
  rtmr2: 'd4'.repeat(48),
  composeHash: 'e5'.repeat(32),
} as const;

export function syntheticEventLog(composeHash: string = SYN.composeHash) {
  const mk = (event: string, payloadHex: string) => {
    const e = { imr: 3, event_type: DSTACK_RUNTIME_EVENT_TYPE, digest: '', event, event_payload: payloadHex };
    e.digest = runtimeEventDigest(e);
    return e;
  };
  return [
    mk('system-preparing', ''),
    mk('app-id', '11'.repeat(20)),
    mk('compose-hash', composeHash),
    mk('instance-id', '22'.repeat(20)),
    mk('boot-mr-done', ''),
  ];
}

export interface SyntheticEnv {
  restore(): void;
  /** Build a bundle for `nodeKey`; `tweak` mutates the pieces before they are signed/assembled. */
  makeBundle(
    nodeKey: string,
    opts?: { nonce?: string; arch?: 'HOPPER' | 'BLACKWELL'; reportDataFor?: string; nrasResult?: boolean },
  ): Promise<{ bundle: AttestationBundle; hpkePrivateKey: CryptoKey }>;
  setNow(ms: number): void;
}

export async function installSyntheticEnv(
  allow: { mrTd?: string[]; composeHash?: string[] } = {},
): Promise<SyntheticEnv> {
  const saved = {
    tdx: { ...tdxDeps },
    nv: { ...nvidiaDeps },
    path: attestSettings.allowlistPath,
  };
  const dir = mkdtempSync(join(tmpdir(), 'spindle-allow-'));
  const file = join(dir, 'allowlist.json');
  writeFileSync(
    file,
    JSON.stringify({
      mrTd: allow.mrTd ?? [SYN.mrTd],
      rtmr0: [SYN.rtmr0],
      rtmr1: [SYN.rtmr1],
      rtmr2: [SYN.rtmr2],
      composes: (allow.composeHash ?? [SYN.composeHash]).map((composeHash) => ({ composeHash, imageDigest: 'sha256:synthetic' })),
    }),
  );
  attestSettings.allowlistPath = file;
  resetAllowlist();
  clearCollateralCache();

  let nowMs = Date.now();
  tdxDeps.now = () => nowMs;
  tdxDeps.fetchCollateral = async () => REAL_COLLATERAL;
  let reportData = '';
  let rtmr3 = '';
  tdxDeps.verify = () =>
    ({
      status: 'UpToDate',
      advisory_ids: [],
      ppid: Buffer.alloc(16),
      report: {
        asTd10: () => ({
          mrTd: Buffer.from(SYN.mrTd, 'hex'),
          rtMr0: Buffer.from(SYN.rtmr0, 'hex'),
          rtMr1: Buffer.from(SYN.rtmr1, 'hex'),
          rtMr2: Buffer.from(SYN.rtmr2, 'hex'),
          rtMr3: Buffer.from(rtmr3, 'hex'),
          reportData: Buffer.from(reportData, 'hex'),
          tdAttributes: Buffer.alloc(8),
        }),
        asTd15: () => null,
        asTd15Ex: () => null,
      },
    }) as unknown as VerifiedReport;

  const { privateKey, publicKey } = await joseKeyPair('ES384');
  nvidiaDeps.jwks = () => (async () => publicKey) as never;
  let nrasResult = true;
  let nrasNonce = '';
  nvidiaDeps.nras = async () => {
    const token = await new SignJWT({ 'x-nvidia-overall-att-result': nrasResult, eat_nonce: nrasNonce })
      .setProtectedHeader({ alg: 'ES384', kid: 'synthetic-nras' })
      .setIssuer(attestSettings.nrasIssuer)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
    return [['JWT', token], { 'GPU-0': token }];
  };

  return {
    setNow: (ms) => {
      nowMs = ms;
    },
    restore() {
      Object.assign(tdxDeps, saved.tdx);
      Object.assign(nvidiaDeps, saved.nv);
      attestSettings.allowlistPath = saved.path;
      resetAllowlist();
    },
    async makeBundle(nodeKey, opts = {}) {
      const hpke = await generateKeyPair();
      const nonce = opts.nonce ?? Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
      const eventLog = syntheticEventLog();
      rtmr3 = replayRtmr3(eventLog as never).rtmr3;
      reportData = expectedReportData(hpke.publicKey, opts.reportDataFor ?? nodeKey, nonce);
      nrasResult = opts.nrasResult ?? true;
      nrasNonce = nonce;
      // trailing bytes make the quote hash unique per bundle (the stubbed verifier ignores them)
      const quote = Buffer.concat([REAL_QUOTE, Buffer.from(nonce, 'hex')]);
      return {
        hpkePrivateKey: hpke.privateKey,
        bundle: {
          tdxQuote: quote.toString('base64'),
          eventLog,
          nvidiaEvidence: { nonce, arch: opts.arch ?? 'HOPPER', evidence_list: [{ evidence: 'synthetic', certificate: 'synthetic' }] },
          hpkePublicKey: hpke.publicKey,
          measurements: { nonce, composeHash: SYN.composeHash },
        },
      };
    },
  };
}

export const evidenceHashOf = (o: unknown): string => canonicalJson(o);
