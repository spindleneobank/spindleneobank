import { parseAbi } from 'viem';

export const spindleClaimsAbi = parseAbi([
  'function lastEpoch() view returns (uint64)',
  'function totalClaimed() view returns (uint256)',
  'function roots(uint64 epoch) view returns (bytes32 root, uint256 totalEarned, uint64 postedAt, bool vetoed)',
  'function claimed(address owner) view returns (uint256)',
  'function postRoot(uint64 epoch, bytes32 root, uint256 totalEarned)',
  'function vetoRoot(uint64 epoch)',
  'function claim(uint64 epoch, uint256 cumulative, bytes32[] proof, uint256 amount)',
  'function claimable(address owner, uint256 cumulative) view returns (uint256)',
  'function latestClaimableEpoch() view returns (uint64)',
  'event RootPosted(uint64 indexed epoch, bytes32 root, uint256 totalEarned)',
  'event RootVetoed(uint64 indexed epoch)',
  'event Claimed(address indexed owner, uint64 indexed epoch, uint256 amount, uint256 claimedTotal)',
]);
