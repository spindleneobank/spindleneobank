import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import {
  type Account,
  type Address,
  createWalletClient,
  custom,
  type Hex,
  keccak256,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts';
import { secrets } from '../config';
import { AppError } from './errors';
import { logger } from './logger';
import { getRedis } from './redis';
import { rpc } from './rpcPool';
import { appChain, publicClient } from './viem';

export const KEEPER_LOCK_KEY = 'keeper:tx-lock';
const LOCK_TTL_MS = 30_000;
const LOCK_RENEW_MS = 10_000;
const LOCK_POLL_MS = 100;
const LOCK_WAIT_MS = 5 * 60_000;
export const KEEPER_LAST_NONCE_KEY = 'keeper:last-nonce';
const LAST_NONCE_TTL_S = 300;
/** Errors that clearly mean the node rejected the tx before accepting it. Everything else is ambiguous. */
const DEFINITE_REJECT =
  /insufficient funds|intrinsic gas too low|exceeds block gas limit|invalid sender|invalid chain id/i;
const RECEIPT_TIMEOUT_MS = 120_000;

export type KeeperTxInput = { to: Address; data?: Hex; value?: bigint; gas?: bigint; label: string };
export type KeeperTxResult =
  | { hash: Hex; status: 'success' | 'reverted'; gasUsed: bigint; effectiveGasPrice: bigint }
  | { hash: Hex; status: 'unknown' };

let account: PrivateKeyAccount | undefined;
/** Keeper account. Throws lazily on first use if KEEPER_PRIVATE_KEY is missing (api role boots without it). */
export function keeperAccount(): PrivateKeyAccount {
  if (account) return account;
  const key = secrets.KEEPER_PRIVATE_KEY;
  if (!key) throw new AppError('INTERNAL', 'KEEPER_PRIVATE_KEY is not configured', 500);
  account = privateKeyToAccount(key.startsWith('0x') ? (key as Hex) : (`0x${key}` as Hex));
  return account;
}

const RELEASE_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;
const RENEW_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` while holding the global keeper lock; the lock is renewed until `fn` settles. */
export async function withKeeperLock<T>(
  redis: Redis,
  fn: () => Promise<T>,
  waitMs = LOCK_WAIT_MS,
): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  while ((await redis.set(KEEPER_LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX')) !== 'OK') {
    if (Date.now() > deadline) throw new AppError('UPSTREAM_UNAVAILABLE', 'keeper lock wait timed out', 503);
    await sleep(LOCK_POLL_MS);
  }
  const timer = setInterval(() => {
    redis.eval(RENEW_LUA, 1, KEEPER_LOCK_KEY, token, String(LOCK_TTL_MS)).catch(() => {});
  }, LOCK_RENEW_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    await redis.eval(RELEASE_LUA, 1, KEEPER_LOCK_KEY, token).catch(() => {});
  }
}

export type KeeperDeps = {
  redis: () => Redis;
  account: () => Account;
  /** Read client (nonce, gas, receipts). */
  client: Pick<
    PublicClient,
    'getTransactionCount' | 'estimateGas' | 'getGasPrice' | 'waitForTransactionReceipt'
  >;
  wallet: (account: Account) => Pick<WalletClient, 'sendRawTransaction'> & {
    signTransaction: (args: never) => Promise<Hex>;
  };
  receiptTimeoutMs: number;
};

function defaultWallet(acct: Account) {
  return createWalletClient({
    account: acct,
    chain: appChain,
    transport: custom({
      request: ({ method, params }) => rpc(method, (params as unknown[] | undefined) ?? []),
    }),
  }) as unknown as ReturnType<KeeperDeps['wallet']>;
}

export function createKeeper(deps: KeeperDeps) {
  async function sendKeeperTx(input: KeeperTxInput): Promise<KeeperTxResult> {
    const acct = deps.account();
    // The lock covers nonce read -> broadcast only (pending nonce already counts in-flight txs);
    // receipt waiting happens outside it so sends are not throttled to one per block.
    const sentResult = await withKeeperLock(deps.redis(), async () => {
      const from = acct.address;
      // Legacy pricing: Orbit chains accept it and it avoids fee-history dependence.
      const [pending, latest, gasPrice] = await Promise.all([
        deps.client.getTransactionCount({ address: from, blockTag: 'pending' }),
        deps.client.getTransactionCount({ address: from, blockTag: 'latest' }),
        deps.client.getGasPrice(),
      ]);
      // Rotating backends can return a stale pending nonce: never go below last sent + 1.
      const redis = deps.redis();
      const lastRaw = await redis.get(KEEPER_LAST_NONCE_KEY);
      let nonce = pending;
      if (lastRaw !== null && /^\d+$/.test(lastRaw)) {
        const last = Number(lastRaw);
        if (latest > last) await redis.del(KEEPER_LAST_NONCE_KEY);
        else nonce = Math.max(pending, last + 1);
      }
      const gas =
        input.gas ??
        ((await deps.client.estimateGas({
          account: from,
          to: input.to,
          data: input.data,
          value: input.value,
        })) *
          12n) /
          10n;
      const price = (gasPrice * 11n) / 10n;
      const wallet = deps.wallet(acct);
      const serialized = await wallet.signTransaction({
        account: acct,
        type: 'legacy',
        to: input.to,
        data: input.data,
        value: input.value,
        nonce,
        gas,
        gasPrice: price,
      } as never);
      const expectedHash = keccak256(serialized);
      await redis.set(KEEPER_LAST_NONCE_KEY, String(nonce), 'EX', LAST_NONCE_TTL_S);
      try {
        const sent = await wallet.sendRawTransaction({ serializedTransaction: serialized });
        logger.info({ label: input.label, hash: sent, nonce, gas: gas.toString() }, 'keeper tx broadcast');
        return { hash: sent, ambiguous: false };
      } catch (err) {
        const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
        if (DEFINITE_REJECT.test(message)) {
          await redis.del(KEEPER_LAST_NONCE_KEY);
          throw err;
        }
        logger.warn(
          { label: input.label, hash: expectedHash, nonce },
          'keeper tx broadcast outcome ambiguous',
        );
        return { hash: expectedHash, ambiguous: true };
      }
    });
    if (sentResult.ambiguous) return { hash: sentResult.hash, status: 'unknown' };
    const hash = sentResult.hash;

    let receipt: TransactionReceipt;
    try {
      receipt = await deps.client.waitForTransactionReceipt({ hash, timeout: deps.receiptTimeoutMs });
    } catch (err) {
      // Never re-send with a new nonce; callers poll getTransactionReceipt(hash) later.
      logger.warn(
        { label: input.label, hash, err: err instanceof Error ? err.name : 'error' },
        'keeper tx outcome unknown',
      );
      return { hash, status: 'unknown' };
    }
    logger.info(
      { label: input.label, hash, status: receipt.status, gasUsed: receipt.gasUsed.toString() },
      'keeper tx mined',
    );
    return {
      hash,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      effectiveGasPrice: receipt.effectiveGasPrice,
    };
  }
  return { sendKeeperTx };
}

const defaultKeeper = createKeeper({
  redis: getRedis,
  account: keeperAccount,
  client: publicClient,
  wallet: defaultWallet,
  receiptTimeoutMs: RECEIPT_TIMEOUT_MS,
});

/** Every keeper transaction (postRoot, settle) goes through here. */
export const sendKeeperTx = defaultKeeper.sendKeeperTx;

export async function keeperBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: keeperAccount().address });
}
