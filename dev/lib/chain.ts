import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  type Address,
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  pad,
  parseAbi,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { spindleRegistryAbi } from '../../src/shared/abi/SpindleRegistry';
import { nodeBindingTypedData } from '../../src/shared/binding';
import { KNOWN, rhc } from '../../src/shared/chain';
import { ALL_ACCOUNTS, account, privateKey } from './accounts';
import { CONTRACTS_DIR, DEPLOYMENT_FILE } from './paths';

export const ANVIL_URL = process.env.ANVIL_URL ?? 'http://127.0.0.1:7245';
export const FORK_URL = process.env.FORK_URL ?? 'https://rpc.mainnet.chain.robinhood.com';
const POOL = '0x69bfaf19c9f377bb306a89aed9f6b07e2c1a8d9a' as const;

export const USDG_TARGET = 10_000_000_000n; // 10,000 USDG (6 decimals)
export const SPDL_TARGET = 100_000n * 10n ** 18n;
export const ETH_TARGET = 10n * 10n ** 18n;

const erc20 = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function mint(address,uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

export const chain = { ...rhc, rpcUrls: { default: { http: [ANVIL_URL] } } };
export const publicClient = createPublicClient({ chain, transport: http(ANVIL_URL) });

export async function rpc<T = unknown>(method: string, params: unknown[] = [], url = ANVIL_URL): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: T; error?: { message: string } };
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitForAnvil(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const id = Number(await rpc<string>('eth_chainId'));
      if (id !== 4663) throw new Error(`anvil chain id is ${id}, expected 4663`);
      return;
    } catch (e) {
      if (e instanceof Error && e.message.includes('expected 4663')) throw e;
      if (Date.now() - start > timeoutMs) throw new Error(`anvil not reachable at ${ANVIL_URL}`);
      await sleep(1000);
    }
  }
}

export const hasCode = async (address: Address) =>
  ((await publicClient.getCode({ address })) ?? '0x') !== '0x';

export interface Deployment {
  chainId: number;
  deployBlock: number;
  commit: string;
  addresses: {
    usdg: Address;
    permit2: Address;
    spdl: Address;
    erc8004Identity: Address;
    relayStub: Address;
    registry: Address;
    staking: Address;
    claims: Address;
    vault: Address;
  };
  args: Record<string, string | number>;
}

export function readDeployment(): Deployment | null {
  if (!existsSync(DEPLOYMENT_FILE)) return null;
  return JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) as Deployment;
}

/** True when the fork's pinned upstream block is no longer served (public RPC keeps ~10 minutes of state). */
export async function forkStateAvailable(): Promise<boolean> {
  try {
    await publicClient.readContract({ address: KNOWN.USDG, abi: erc20, functionName: 'decimals' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Re-forks anvil at a recent upstream block. Wipes local chain state (deployments); only call when
 * nothing of ours is deployed. The public RHC RPC is not an archive node, so a fork block older than
 * ~10 minutes cannot serve fresh state reads.
 */
export async function refork(): Promise<number> {
  const latest = Number(await rpc<string>('eth_blockNumber', [], FORK_URL));
  const blockNumber = latest - 20;
  await rpc('anvil_reset', [{ forking: { jsonRpcUrl: FORK_URL, blockNumber } }]);
  return blockNumber;
}

/** Touch the external contracts we depend on so anvil caches their state before the upstream block expires. */
export async function warmFork(): Promise<void> {
  const accounts = ALL_ACCOUNTS.map((a) => a.address);
  await Promise.allSettled([
    ...[
      KNOWN.USDG,
      KNOWN.PERMIT2,
      KNOWN.ERC8004_IDENTITY,
      KNOWN.UNISWAP_V3_FACTORY,
      KNOWN.WETH,
      KNOWN.NVDA,
      POOL,
    ].map((address) => publicClient.getCode({ address })),
    ...[POOL, ...accounts].map((a) =>
      publicClient.readContract({ address: KNOWN.USDG, abi: erc20, functionName: 'balanceOf', args: [a] }),
    ),
    publicClient.readContract({ address: KNOWN.USDG, abi: erc20, functionName: 'symbol' }),
  ]);
}

export function deployContracts(): void {
  const keeper = account(1).address;
  const gs = account(2).address;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    FORK: '1',
    DEPLOY_DEV_STUBS: 'true',
    USDG: KNOWN.USDG,
    PERMIT2: KNOWN.PERMIT2,
    ERC8004_IDENTITY: KNOWN.ERC8004_IDENTITY,
    TREASURY: gs,
    KEEPER: keeper,
    GUARDIAN: gs,
    SLASHER: gs,
    SLASH_RECIPIENT: gs,
    MIN_STAKE_1: String(1_000n * 10n ** 18n),
    MIN_STAKE_2: String(5_000n * 10n ** 18n),
    MIN_STAKE_3: String(25_000n * 10n ** 18n),
    MIN_STAKE_4: String(50_000n * 10n ** 18n),
    COMMIT: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: CONTRACTS_DIR, encoding: 'utf8' }).stdout.trim(),
  };
  // A stale SPDL would skip the MockERC20 deploy; the fork always uses the mock.
  delete env.SPDL;
  const r = spawnSync(
    'forge',
    [
      'script',
      'script/Deploy.s.sol',
      '--rpc-url',
      ANVIL_URL,
      '--broadcast',
      '--private-key',
      privateKey(0),
      '--slow',
    ],
    { cwd: CONTRACTS_DIR, env, encoding: 'utf8' },
  );
  if (r.status !== 0) {
    throw new Error(
      `forge script failed:\n${(r.stdout + r.stderr).replaceAll(privateKey(0), '<key>').slice(-3000)}`,
    );
  }
}

async function mineWait(hash: Hex) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`tx ${hash} reverted`);
}

async function bal(token: Address, who: Address): Promise<bigint> {
  return publicClient.readContract({ address: token, abi: erc20, functionName: 'balanceOf', args: [who] });
}

/** Sets accounts 0-9 to 10 ETH when below 5 ETH (gas spend must not make reruns non-idempotent). */
export async function seedEth(): Promise<number> {
  let n = 0;
  for (const a of ALL_ACCOUNTS) {
    const b = await publicClient.getBalance({ address: a.address });
    if (b < ETH_TARGET / 2n) {
      await rpc('anvil_setBalance', [a.address, toHex(ETH_TARGET)]);
      n++;
    }
  }
  return n;
}

/** Mints MockSPDL so that accounts 0-9 hold at least 100,000. */
export async function seedSpdl(spdl: Address): Promise<number> {
  const wallet = createWalletClient({ account: account(0), chain, transport: http(ANVIL_URL) });
  let n = 0;
  for (const a of ALL_ACCOUNTS) {
    const b = await bal(spdl, a.address);
    if (b < SPDL_TARGET) {
      await mineWait(
        await wallet.writeContract({
          address: spdl,
          abi: erc20,
          functionName: 'mint',
          args: [a.address, SPDL_TARGET - b],
        }),
      );
      n++;
    }
  }
  return n;
}

export type UsdgMethod = 'none' | 'impersonate' | 'storage';

/**
 * Tops accounts 0-9 up to 10,000 USDG. Primary: impersonate the USDG/WETH pool and transfer.
 * Fallback: find USDG's balance mapping slot by probing slots 0-20 and write balances with anvil_setStorageAt.
 */
export async function seedUsdg(): Promise<{ method: UsdgMethod; accounts: number }> {
  const todo: { address: Address; need: bigint }[] = [];
  for (const a of ALL_ACCOUNTS) {
    const b = await bal(KNOWN.USDG, a.address);
    if (b < USDG_TARGET) todo.push({ address: a.address, need: USDG_TARGET - b });
  }
  if (!todo.length) return { method: 'none', accounts: 0 };
  const total = todo.reduce((s, t) => s + t.need, 0n);

  if ((await bal(KNOWN.USDG, POOL)) >= total) {
    await rpc('anvil_setBalance', [POOL, toHex(ETH_TARGET)]);
    await rpc('anvil_impersonateAccount', [POOL]);
    try {
      const wallet = createWalletClient({ account: POOL, chain, transport: http(ANVIL_URL) });
      for (const t of todo) {
        await mineWait(
          await wallet.writeContract({
            address: KNOWN.USDG,
            abi: erc20,
            functionName: 'transfer',
            args: [t.address, t.need],
          }),
        );
      }
    } finally {
      await rpc('anvil_stopImpersonatingAccount', [POOL]);
    }
    return { method: 'impersonate', accounts: todo.length };
  }

  const slot = await findBalanceSlot(KNOWN.USDG);
  for (const t of todo) {
    const key = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [t.address, BigInt(slot)]),
    );
    await rpc('anvil_setStorageAt', [KNOWN.USDG, key, pad(toHex(USDG_TARGET), { size: 32 })]);
  }
  return { method: 'storage', accounts: todo.length };
}

async function findBalanceSlot(token: Address): Promise<number> {
  const probe = ALL_ACCOUNTS[9]?.address as Address;
  const sentinel = 123_456_789n;
  for (let slot = 0; slot <= 20; slot++) {
    const key = keccak256(
      encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [probe, BigInt(slot)]),
    );
    const old = await rpc<Hex>('eth_getStorageAt', [token, key, 'latest']);
    await rpc('anvil_setStorageAt', [token, key, pad(toHex(sentinel), { size: 32 })]);
    const seen = await bal(token, probe);
    await rpc('anvil_setStorageAt', [token, key, old]);
    if (seen === sentinel) return slot;
  }
  throw new Error('USDG balance slot not found in slots 0-20');
}

/**
 * Registers the house node (class 0, no stake) from account 0 when a node key is provided via
 * HOUSE_NODE_KEY (0x hex) or the file HOUSE_NODE_KEY_FILE. Returns a status line.
 */
export async function registerHouseNode(registry: Address): Promise<string> {
  let key = process.env.HOUSE_NODE_KEY?.trim();
  const file = process.env.HOUSE_NODE_KEY_FILE;
  if (!key && file && existsSync(file)) key = readFileSync(file, 'utf8').trim();
  if (!key) {
    return 'skipped (no house node key: set HOUSE_NODE_KEY or HOUSE_NODE_KEY_FILE and rerun to register it on-chain)';
  }
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(key)) return 'skipped (HOUSE_NODE_KEY is not a 32-byte hex key)';
  const nodeAccount = privateKeyToAccount((key.startsWith('0x') ? key : `0x${key}`) as Hex);
  const existing = await publicClient.readContract({
    address: registry,
    abi: spindleRegistryAbi,
    functionName: 'nodeIdOfKey',
    args: [nodeAccount.address],
  });
  if (existing !== 0n) return `already registered (node id ${existing}, key ${nodeAccount.address})`;

  const owner = account(0);
  const block = await publicClient.getBlock();
  const deadline = block.timestamp + 3600n;
  const signature = await nodeAccount.signTypedData(
    nodeBindingTypedData({
      registry,
      chainId: 4663,
      owner: owner.address,
      nodeKey: nodeAccount.address,
      gpuClass: 0,
      ccCapable: false,
      deadline,
    }),
  );
  const wallet = createWalletClient({ account: owner, chain, transport: http(ANVIL_URL) });
  const hash = await wallet.writeContract({
    address: registry,
    abi: spindleRegistryAbi,
    functionName: 'registerNode',
    args: [nodeAccount.address, 0, false, concat([pad('0x', { size: 32 })]), deadline, signature],
  });
  await mineWait(hash);
  const id = await publicClient.readContract({
    address: registry,
    abi: spindleRegistryAbi,
    functionName: 'nodeIdOfKey',
    args: [nodeAccount.address],
  });
  return `registered (node id ${id}, key ${nodeAccount.address}, class 0, no stake)`;
}
