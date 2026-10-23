import type { NodeView } from '@spindle/shared/api';
import { formatUnits, parseUnits } from 'viem';

export const SPDL_DECIMALS = 18;

export type NodeOsId = 'linux' | 'windows' | 'macos';
export type EngineId = 'ollama' | 'vllm';

/** Install-time constraints: vLLM needs an NVIDIA 24 GB+ GPU, which a Mac does not have. */
export function engineAllowed(os: NodeOsId, engine: EngineId): boolean {
  return !(os === 'macos' && engine === 'vllm');
}

/** Upper-cases, strips junk and inserts the hyphen: "abcd1234" -> "ABCD-1234". */
export function normalizePairCode(raw: string): string {
  const s = raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
  return s.length > 4 ? `${s.slice(0, 4)}-${s.slice(4)}` : s;
}
export const isPairCode = (c: string) => /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(c);

/** SPDL input ("12.5") -> wei, or null for empty / invalid / zero input. */
export function parseSpdl(input: string): bigint | null {
  const t = input.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  try {
    const v = parseUnits(t, SPDL_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

/** wei string -> "1,250" / "0.5" (grouped, trailing zeros trimmed). */
export function fmtSpdl(wei: string | bigint): string {
  const s = formatUnits(BigInt(wei), SPDL_DECIMALS);
  const [whole = '0', frac] = s.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${grouped}.${frac.slice(0, 4).replace(/0+$/, '') || '0'}`.replace(/\.0$/, '') : grouped;
}

export type StatusTone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';
export function statusTone(status: NodeView['status']): StatusTone {
  switch (status) {
    case 'online':
      return 'ok';
    case 'busy':
      return 'info';
    case 'suspended':
      return 'danger';
    case 'offline':
      return 'warn';
    default:
      return 'neutral';
  }
}

export const CLASS_LABEL: Record<number, string> = {
  0: 'Class 0 · CPU / other',
  1: 'Class 1 · 16 GB+',
  2: 'Class 2 · RTX 4090 / 5090',
  3: 'Class 3 · H100 / H200 (CC)',
  4: 'Class 4 · B200 / B300 (CC)',
};

export type StakeState = 'unregistered' | 'unstaked' | 'below-min' | 'staked';
/** Staking is optional: it only decides the priority tier. */
export function stakeState(n: Pick<NodeView, 'registered' | 'stake'>): StakeState {
  if (!n.registered) return 'unregistered';
  const active = BigInt(n.stake.active);
  if (active === 0n) return 'unstaked';
  return active >= BigInt(n.stake.min) ? 'staked' : 'below-min';
}

export type WalletBlock = 'no-wallet' | 'wrong-chain' | 'wrong-account' | null;
/** Wallet actions need the session account connected on the app chain. */
export function walletBlock(w: {
  address?: string;
  isConnected: boolean;
  chainId?: number;
  sessionAddress?: string;
  expectedChainId: number;
}): WalletBlock {
  if (!w.isConnected || !w.address) return 'no-wallet';
  if (w.sessionAddress && w.address.toLowerCase() !== w.sessionAddress.toLowerCase()) return 'wrong-account';
  if (w.chainId !== w.expectedChainId) return 'wrong-chain';
  return null;
}

export const WALLET_BLOCK_TEXT: Record<Exclude<WalletBlock, null>, string> = {
  'no-wallet': 'Connect your wallet to send transactions.',
  'wrong-chain': 'Switch your wallet to the Spindle network to continue.',
  'wrong-account': 'Connect the wallet you signed in with. Transactions must come from that account.',
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};

export type CheckResult = { ok: boolean; at?: string; note?: string };

/** Probe rows are loosely typed by the API; read what is there. */
export function readProbe(v: unknown): CheckResult | null {
  if (!isObj(v) || typeof v.classOk !== 'boolean') return null;
  const tps = num(v.tokPerSec);
  return {
    ok: v.classOk,
    at: str(v.createdAt),
    note: tps === undefined ? undefined : `${tps.toFixed(1)} tok/s`,
  };
}
export function readCanary(v: unknown): CheckResult | null {
  if (!isObj(v) || typeof v.pass !== 'boolean') return null;
  return { ok: v.pass, at: str(v.createdAt), note: str(v.kind) };
}

export type JobRow = { id: string; model: string; status: string; units: string; at?: string };
export function readJob(v: unknown): JobRow | null {
  if (!isObj(v) || typeof v.id !== 'string') return null;
  return {
    id: v.id,
    model: str(v.model) ?? '?',
    status: str(v.status) ?? '?',
    units: String(v.units ?? ''),
    at: str(v.createdAt),
  };
}
