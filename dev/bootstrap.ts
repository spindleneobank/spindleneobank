/**
 * `bun run dev:bootstrap`: turns a fresh dev stack (anvil RHC fork + postgres) into a complete local world.
 * Idempotent: every step checks before acting; a second run changes nothing.
 * Flags: --reset-fork  re-fork anvil at a recent upstream block (wipes local chain state) even if deployed.
 */
import { type Address, getAddress, parseAbi } from 'viem';
import { KNOWN } from '../src/shared/chain';
import { ALL_ACCOUNTS, account, privateKey } from './lib/accounts';
import {
  ANVIL_URL,
  deployContracts,
  forkStateAvailable,
  hasCode,
  publicClient,
  readDeployment,
  refork,
  registerHouseNode,
  seedEth,
  seedSpdl,
  seedUsdg,
  waitForAnvil,
  warmFork,
} from './lib/chain';
import { updateEnvFile } from './lib/env';
import { BACKEND_ENV_DEV, DEPLOYMENT_FILE, WEB_ENV_DEV } from './lib/paths';
import { seed } from './seed';

const log = (msg: string) => console.log(`[bootstrap] ${msg}`);
const lc = (a: string) => a.toLowerCase();

const poolAbi = parseAbi(['function getPool(address,address,uint24) view returns (address)']);
const metaAbi = parseAbi([
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
]);

async function ensureFork(deployed: boolean): Promise<void> {
  const forceReset = process.argv.includes('--reset-fork');
  const fresh = await forkStateAvailable();
  if (fresh && !forceReset) return;
  if (deployed && !forceReset) {
    log(
      'WARNING: the fork cannot read new upstream state (public RHC RPC is not an archive node; the pinned fork block expired). ' +
        'Already-cached and local state still works. Use --reset-fork to re-fork (wipes local chain state) or set FORK_URL to an archive RPC.',
    );
    return;
  }
  const block = await refork();
  log(`fork state expired: re-forked anvil at upstream block ${block} (local chain state reset)`);
}

async function main() {
  log(`waiting for anvil at ${ANVIL_URL}`);
  await waitForAnvil();
  log('anvil ok (chain 4663)');

  let dep = readDeployment();
  const deployed = !!dep && (await hasCode(dep.addresses.registry));
  await ensureFork(deployed);
  const needsDeploy = process.argv.includes('--reset-fork') || !deployed;
  await warmFork();

  if (needsDeploy) {
    log('deploying contracts (forge script, FORK=1 DEPLOY_DEV_STUBS=true)');
    deployContracts();
    dep = readDeployment();
  } else {
    log('contracts already deployed: skipping deploy');
  }
  if (!dep) throw new Error(`deployment file missing after deploy: ${DEPLOYMENT_FILE}`);
  const a = dep.addresses;

  const usdg = await seedUsdg();
  log(
    usdg.method === 'none'
      ? 'USDG: accounts 0-9 already hold 10,000'
      : `USDG: topped up ${usdg.accounts} accounts via ${usdg.method}`,
  );
  log(`ETH: topped up ${await seedEth()} accounts to 10 ETH`);
  log(`MockSPDL: minted for ${await seedSpdl(a.spdl)} accounts`);

  const house = await registerHouseNode(a.registry);
  log(`house node: ${house}`);

  // env files
  const backendChanged = updateEnvFile(BACKEND_ENV_DEV, {
    USDG_ADDRESS: lc(a.usdg),
    PERMIT2_ADDRESS: lc(a.permit2),
    ERC8004_IDENTITY_ADDRESS: lc(a.erc8004Identity),
    UNISWAP_V3_FACTORY: lc(KNOWN.UNISWAP_V3_FACTORY),
    SPDL_ADDRESS: lc(a.spdl),
    REGISTRY_ADDRESS: lc(a.registry),
    STAKING_ADDRESS: lc(a.staking),
    CLAIMS_ADDRESS: lc(a.claims),
    VAULT_ADDRESS: lc(a.vault),
    RELAY_STUB_ADDRESS: lc(a.relayStub),
    TREASURY_ADDRESS: lc(account(2).address),
    HOUSE_OWNER_ADDRESS: lc(account(0).address),
    ADMIN_ADDRESSES: lc(account(0).address),
    DEPLOY_BLOCK: String(dep.deployBlock),
    KEEPER_PRIVATE_KEY: privateKey(1), // anvil account 1: public dev key
  });
  const webChanged = updateEnvFile(WEB_ENV_DEV, {
    VITE_CHAIN_ID: '4663',
    VITE_RPC_URL: 'http://127.0.0.1:7245',
    VITE_USDG_ADDRESS: getAddress(a.usdg),
    VITE_PERMIT2_ADDRESS: getAddress(a.permit2),
    VITE_SPDL_ADDRESS: getAddress(a.spdl),
    VITE_REGISTRY_ADDRESS: getAddress(a.registry),
    VITE_STAKING_ADDRESS: getAddress(a.staking),
    VITE_CLAIMS_ADDRESS: getAddress(a.claims),
    VITE_VAULT_ADDRESS: getAddress(a.vault),
  });
  log(`backend.env.dev: ${backendChanged.length ? `updated ${backendChanged.join(', ')}` : 'unchanged'}`);
  log(`web/.env.development.local: ${webChanged.length ? `updated ${webChanged.join(', ')}` : 'unchanged'}`);

  // DB seed
  let stock:
    | { symbol: string; name: string | null; decimals: number; poolAddress: string | null }
    | undefined;
  try {
    const [symbol, name, decimals, pool] = await Promise.all([
      publicClient.readContract({ address: KNOWN.NVDA, abi: metaAbi, functionName: 'symbol' }),
      publicClient
        .readContract({ address: KNOWN.NVDA, abi: metaAbi, functionName: 'name' })
        .catch(() => null),
      publicClient.readContract({ address: KNOWN.NVDA, abi: metaAbi, functionName: 'decimals' }),
      publicClient.readContract({
        address: KNOWN.UNISWAP_V3_FACTORY,
        abi: poolAbi,
        functionName: 'getPool',
        args: [KNOWN.NVDA, KNOWN.USDG, 500],
      }),
    ]);
    stock = {
      symbol,
      name,
      decimals,
      poolAddress: pool === '0x0000000000000000000000000000000000000000' ? null : pool,
    };
  } catch (e) {
    log(`NVDA token lookup failed, stock_tokens not seeded: ${(e as Error).message.split('\n')[0]}`);
  }
  const s = await seed({ stock });
  log(
    `db seed: +${s.rateCard} rate_card, +${s.models} models, +${s.stockTokens} stock_tokens, +${s.admin} admin users`,
  );

  summary(a, dep.deployBlock);
}

function summary(a: Record<string, Address>, deployBlock: number) {
  const rows: [string, string][] = [
    ['USDG (real, fork)', a.usdg as string],
    ['SPDL (MockERC20)', a.spdl as string],
    ['SpindleRegistry', a.registry as string],
    ['SpindleStaking', a.staking as string],
    ['SpindleClaims', a.claims as string],
    ['BuyerVault', a.vault as string],
    ['RelayStubDepository', a.relayStub as string],
    ['Deploy block', String(deployBlock)],
    ['Admin / house owner (acct 0)', account(0).address],
    ['Keeper (acct 1)', account(1).address],
    ['Guardian/slasher/treasury (acct 2)', account(2).address],
    ['Test users (acct 3-9)', `${ALL_ACCOUNTS[3]?.address} .. ${ALL_ACCOUNTS[9]?.address}`],
    ['Anvil RPC', ANVIL_URL],
    ['API', 'http://127.0.0.1:7200 (https://ascsuqqaav.mycoin.wtf)'],
    ['izipay mock', 'http://127.0.0.1:7290'],
    ['Postgres / Redis', '127.0.0.1:7232 / 127.0.0.1:7279'],
  ];
  const w = Math.max(...rows.map((r) => r[0].length));
  console.log(`\n${rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n')}\n`);
  console.log(
    '  Restart api/worker to pick up changed address env vars: docker compose -f docs/deploy/compose.dev.yml up -d',
  );
}

main().catch((e) => {
  console.error(`[bootstrap] FAILED: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
