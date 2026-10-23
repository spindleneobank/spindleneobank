import {
  buyerVaultAbi,
  erc20Abi,
  permit2Abi,
  spindleClaimsAbi,
  spindleRegistryAbi,
  spindleStakingAbi,
} from '@spindle/shared/abi';
import { type Address, getContract } from 'viem';
import { config } from '../config';
import { AppError } from './errors';
import { publicClient } from './viem';

const ENV_NAMES = {
  registry: 'REGISTRY_ADDRESS',
  staking: 'STAKING_ADDRESS',
  claims: 'CLAIMS_ADDRESS',
  vault: 'VAULT_ADDRESS',
  usdg: 'USDG_ADDRESS',
  spdl: 'SPDL_ADDRESS',
  permit2: 'PERMIT2_ADDRESS',
} as const;
export type ContractName = keyof typeof ENV_NAMES;

export type AddressMap = Record<ContractName, Address | undefined>;

/** Configured addresses (undefined where not configured). */
export function addresses(): AddressMap {
  const out = {} as AddressMap;
  for (const name of Object.keys(ENV_NAMES) as ContractName[]) {
    out[name] = config[ENV_NAMES[name]] as Address | undefined;
  }
  return out;
}

export function requireAddress(name: ContractName): Address {
  const value = addresses()[name];
  if (!value) throw new AppError('INTERNAL', `${ENV_NAMES[name]} is not configured`, 500);
  return value;
}

/** Typed read handles. Throws a clear error if an address is not configured. */
export function contracts() {
  const client = publicClient;
  return {
    registry: getContract({ address: requireAddress('registry'), abi: spindleRegistryAbi, client }),
    staking: getContract({ address: requireAddress('staking'), abi: spindleStakingAbi, client }),
    claims: getContract({ address: requireAddress('claims'), abi: spindleClaimsAbi, client }),
    vault: getContract({ address: requireAddress('vault'), abi: buyerVaultAbi, client }),
    usdg: getContract({ address: requireAddress('usdg'), abi: erc20Abi, client }),
    spdl: getContract({ address: requireAddress('spdl'), abi: erc20Abi, client }),
    permit2: getContract({ address: requireAddress('permit2'), abi: permit2Abi, client }),
  };
}
