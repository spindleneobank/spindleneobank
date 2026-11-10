/**
 * Sets `deployBlock` in a deployment manifest from the broadcast receipts.
 *
 * Robinhood Chain is an Arbitrum chain: `block.number` inside the deploy script is the parent-chain block, not the
 * chain's own block that the indexer scans. The receipts carry the real block, so run this right after the mainnet
 * broadcast and before copying `deployBlock` into DEPLOY_BLOCK:
 *
 *   bun run scripts/deploy-block.ts [--chain 4663] [--fork]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Receipt = { contractAddress?: string | null; blockNumber: string };
type Manifest = { deployBlock: number; addresses: Record<string, string> };

const ZERO = '0x0000000000000000000000000000000000000000';
const DEPLOYED = ['registry', 'staking', 'claims', 'vault'] as const;

/** The lowest receipt block among the manifest's contracts. Throws if a deployed contract has no receipt. */
export function deployBlockFromReceipts(manifest: Manifest, receipts: Receipt[]): number {
  const byAddress = new Map<string, number>();
  for (const r of receipts) {
    if (r.contractAddress) byAddress.set(r.contractAddress.toLowerCase(), Number(BigInt(r.blockNumber)));
  }
  const blocks: number[] = [];
  for (const key of DEPLOYED) {
    const address = manifest.addresses[key]?.toLowerCase();
    if (!address || address === ZERO) continue;
    const block = byAddress.get(address);
    if (block === undefined) throw new Error(`${key} ${address} has no receipt in the broadcast file`);
    blocks.push(block);
  }
  if (blocks.length === 0) throw new Error('the manifest names no deployed contract');
  return Math.min(...blocks);
}

function main(): void {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--chain');
  const chain = i >= 0 ? argv[i + 1] : '4663';
  const fork = argv.includes('--fork');
  const root = new URL('../contracts/', import.meta.url).pathname;
  const manifestPath = join(root, 'deployments', `${chain}${fork ? '-fork' : ''}.json`);
  const broadcastPath = join(root, 'broadcast', 'Deploy.s.sol', String(chain), 'run-latest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const { receipts } = JSON.parse(readFileSync(broadcastPath, 'utf8')) as { receipts: Receipt[] };
  const block = deployBlockFromReceipts(manifest, receipts);
  if (manifest.deployBlock === block) {
    console.log(`deployBlock already ${block}`);
    return;
  }
  console.log(`deployBlock ${manifest.deployBlock} -> ${block} (${manifestPath})`);
  manifest.deployBlock = block;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
