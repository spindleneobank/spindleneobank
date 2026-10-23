// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice $SPDL staking per node: optional, defines the "staked" priority tier.
interface ISpindleStaking {
    event Staked(uint256 indexed nodeId, address indexed owner, uint256 amount);
    event UnstakeStarted(uint256 indexed nodeId, uint256 amount, uint64 unlockAt);
    event Unstaked(uint256 indexed nodeId, address indexed to, uint256 amount);
    event Slashed(uint256 indexed nodeId, uint16 bps, uint256 amount, bytes32 evidenceHash);

    error NotNodeOwner();
    error NodeNotActive();
    error ZeroAmount();
    error InsufficientStake();
    error NothingPending();
    error StillLocked();
    error NotSlasher();
    error BpsTooHigh();

    function stake(uint256 nodeId, uint256 amount) external;
    function beginUnstake(uint256 nodeId, uint256 amount) external;
    function completeUnstake(uint256 nodeId) external;
    function slash(uint256 nodeId, uint16 bps, bytes32 evidenceHash) external;
    function stakeOf(uint256 nodeId) external view returns (uint256 active, uint256 pending, uint64 unlockAt);
    function minStake(uint8 gpuClass) external view returns (uint256);
    function meetsMinimum(uint256 nodeId) external view returns (bool);
}
