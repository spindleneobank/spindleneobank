/**
 * Post-deploy check: does the chain hold what this commit builds, configured the way the manifest says? Compares
 * runtime bytecode against `contracts/out`, with immutables masked, then reads every immutable through its getter.
 * Exits non-zero on any mismatch. Read-only: it never signs anything.
 *
 *   forge build --root contracts && bun run scripts/verify-deploy.ts --rpc <url> [--manifest <path>]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicClient, getAddress, http, parseAbi } from 'viem';

export type Artifact = {
  deployedBytecode: {
    object: string;
    immutableReferences?: Record<string, { start: number; length: number }[]>;
  };
};
export type Manifest = {
  chainId: number;
  addresses: Record<string, string>;
  args: Record<string, string | number>;
};
export type Chain = {
  chainId: () => Promise<number>;
  code: (address: string) => Promise<string | undefined>;
  read: (address: string, signature: string, args?: readonly unknown[]) => Promise<unknown>;
};

/** Blanks the immutable ranges, which legitimately differ from the build output. */
export function maskImmutables(code: string, artifact: Artifact): string {
  const chars = code.replace(/^0x/, '').toLowerCase().split('');
  for (const refs of Object.values(artifact.deployedBytecode.immutableReferences ?? {})) {
    for (const { start, length } of refs) chars.fill('0', start * 2, (start + length) * 2);
  }
  return chars.join('');
}

export const CONTRACTS = {
  registry: 'SpindleRegistry',
  staking: 'SpindleStaking',
  claims: 'SpindleClaims',
  vault: 'BuyerVault',
} as const;

const sameValue = (a: unknown, b: unknown) =>
  typeof a === 'string' && a.startsWith('0x')
    ? String(b).toLowerCase() === a.toLowerCase()
    : String(a) === String(b);

/** Returns what is wrong; empty means the deployment matches. */
export async function verifyDeployment(
  manifest: Manifest,
  artifacts: Record<string, Artifact>,
  chain: Chain,
): Promise<string[]> {
  const problems: string[] = [];
  const { addresses: a, args } = manifest;
  const live = await chain.chainId();
  if (live !== manifest.chainId) problems.push(`chain id is ${live}, manifest says ${manifest.chainId}`);

  for (const [key, name] of Object.entries(CONTRACTS)) {
    const address = a[key];
    const artifact = artifacts[name];
    if (!address || !artifact) {
      problems.push(`${name}: missing from the manifest or the build`);
      continue;
    }
    const code = await chain.code(address);
    if (!code || code === '0x') {
      problems.push(`${name}: no code at ${address}`);
      continue;
    }
    if (maskImmutables(code, artifact) !== maskImmutables(artifact.deployedBytecode.object, artifact)) {
      problems.push(`${name}: bytecode at ${address} differs from this build`);
    }
  }

  const checks: [string, string, unknown, (readonly unknown[])?][] = [
    ['claims', 'function usdg() view returns (address)', a.usdg],
    ['claims', 'function poster() view returns (address)', args.keeper],
    ['claims', 'function guardian() view returns (address)', args.guardian],
    ['claims', 'function maxEpochIncrease() view returns (uint256)', args.maxEpochIncrease],
    ['claims', 'function claimDelay() view returns (uint64)', args.claimDelay],
    ['vault', 'function usdg() view returns (address)', a.usdg],
    ['vault', 'function permit2() view returns (address)', a.permit2],
    ['vault', 'function claims() view returns (address)', a.claims],
    ['vault', 'function treasury() view returns (address)', args.treasury],
    ['vault', 'function settler() view returns (address)', args.keeper],
    ['staking', 'function spdl() view returns (address)', a.spdl],
    ['staking', 'function registry() view returns (address)', a.registry],
    ['staking', 'function slasher() view returns (address)', args.slasher],
    ['staking', 'function slashRecipient() view returns (address)', args.slashRecipient],
    ['registry', 'function identityRegistry() view returns (address)', a.erc8004Identity],
    ...[0, 1, 2, 3, 4].map(
      (c) =>
        ['staking', 'function minStake(uint8) view returns (uint256)', args[`minStake${c}`], [c]] as [
          string,
          string,
          unknown,
          readonly unknown[],
        ],
    ),
  ];
  for (const [key, signature, want, callArgs] of checks) {
    const label = `${key}.${signature.split(' ')[1]}${callArgs ? `[${callArgs}]` : ''}`;
    if (want === undefined) {
      problems.push(`${label}: not in the manifest`);
      continue;
    }
    try {
      const got = await chain.read(a[key] as string, signature, callArgs);
      if (!sameValue(want, got)) problems.push(`${label} is ${got}, manifest says ${want}`);
    } catch (err) {
      problems.push(`${label}: could not read (${err instanceof Error ? err.message.split('\n')[0] : err})`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opt = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rpc = opt('rpc');
  if (!rpc) throw new Error('usage: verify-deploy.ts --rpc <url> [--manifest <path>]');
  const root = new URL('../contracts/', import.meta.url).pathname;
  const client = createPublicClient({ transport: http(rpc) });
  const manifestPath = opt('manifest') ?? join(root, 'deployments', `${await client.getChainId()}.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
  const artifacts = Object.fromEntries(
    Object.values(CONTRACTS).map((name) => [
      name,
      JSON.parse(readFileSync(join(root, 'out', `${name}.sol`, `${name}.json`), 'utf8')) as Artifact,
    ]),
  );
  const problems = await verifyDeployment(manifest, artifacts, {
    chainId: () => client.getChainId(),
    code: (address) => client.getCode({ address: getAddress(address) }),
    read: (address, signature, args) =>
      client.readContract({
        address: getAddress(address),
        abi: parseAbi([signature] as readonly string[]) as never,
        functionName: signature.split(' ')[1]?.split('(')[0] as never,
        args: args as never,
      }) as Promise<unknown>,
  });
  for (const p of problems) console.error(`MISMATCH ${p}`);
  if (problems.length > 0) process.exit(1);
  console.log(`OK: ${manifestPath} matches this build on chain ${manifest.chainId}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  });
}
