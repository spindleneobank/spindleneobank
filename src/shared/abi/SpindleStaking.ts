import { parseAbi } from 'viem';

export const spindleStakingAbi = parseAbi([
  'function UNSTAKE_DELAY() view returns (uint64)',
  'function stake(uint256 nodeId, uint256 amount)',
  'function beginUnstake(uint256 nodeId, uint256 amount)',
  'function completeUnstake(uint256 nodeId)',
  'function slash(uint256 nodeId, uint16 bps, bytes32 evidenceHash)',
  'function stakeOf(uint256 nodeId) view returns (uint256 active, uint256 pending, uint64 unlockAt)',
  'function minStake(uint8 gpuClass) view returns (uint256)',
  'function meetsMinimum(uint256 nodeId) view returns (bool)',
  'event Staked(uint256 indexed nodeId, address indexed owner, uint256 amount)',
  'event UnstakeStarted(uint256 indexed nodeId, uint256 amount, uint64 unlockAt)',
  'event Unstaked(uint256 indexed nodeId, address indexed to, uint256 amount)',
  'event Slashed(uint256 indexed nodeId, uint16 bps, uint256 amount, bytes32 evidenceHash)',
]);
