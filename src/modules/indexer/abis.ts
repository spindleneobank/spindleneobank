import { buyerVaultAbi, spindleClaimsAbi, spindleRegistryAbi, spindleStakingAbi } from '@spindle/shared/abi';

export const buyerAbis = [...spindleRegistryAbi, ...spindleStakingAbi, ...spindleClaimsAbi, ...buyerVaultAbi];
