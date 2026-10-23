// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISpindleStaking} from "./interfaces/ISpindleStaking.sol";
import {ISpindleRegistry} from "./interfaces/ISpindleRegistry.sol";

/// @title SpindleStaking
/// @notice Owner-less $SPDL staking per node. Staking is optional; the per-class minimum only defines
/// the "staked" priority tier. 7-day unstake delay; only the immutable slasher can slash.
contract SpindleStaking is ISpindleStaking, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint64 public constant UNSTAKE_DELAY = 7 days;

    IERC20 public immutable spdl;
    ISpindleRegistry public immutable registry;
    address public immutable slasher;
    address public immutable slashRecipient;
    uint256 private immutable _min1;
    uint256 private immutable _min2;
    uint256 private immutable _min3;
    uint256 private immutable _min4;

    struct Stake {
        uint256 active;
        uint256 pending;
        uint64 unlockAt;
    }

    mapping(uint256 => Stake) private _stakes;

    constructor(
        IERC20 spdl_,
        ISpindleRegistry registry_,
        address slasher_,
        address slashRecipient_,
        uint256 minStake1,
        uint256 minStake2,
        uint256 minStake3,
        uint256 minStake4
    ) {
        spdl = spdl_;
        registry = registry_;
        slasher = slasher_;
        slashRecipient = slashRecipient_;
        _min1 = minStake1;
        _min2 = minStake2;
        _min3 = minStake3;
        _min4 = minStake4;
    }

    /// @notice Stake SPDL on an active node you own (caller must have approved this contract).
    /// @param nodeId node id
    /// @param amount SPDL amount (18 dec)
    function stake(uint256 nodeId, uint256 amount) external nonReentrant {
        ISpindleRegistry.Node memory n = registry.getNode(nodeId);
        if (n.owner != msg.sender) revert NotNodeOwner();
        if (!n.active) revert NodeNotActive();
        if (amount == 0) revert ZeroAmount();
        _stakes[nodeId].active += amount;
        spdl.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(nodeId, msg.sender, amount);
    }

    /// @notice Move active stake into the 7-day cooldown; resets unlockAt if pending exists. Always allowed.
    /// @param nodeId node id
    /// @param amount amount to move from active to pending
    function beginUnstake(uint256 nodeId, uint256 amount) external {
        if (registry.ownerOf(nodeId) != msg.sender) revert NotNodeOwner();
        if (amount == 0) revert ZeroAmount();
        Stake storage s = _stakes[nodeId];
        if (amount > s.active) revert InsufficientStake();
        s.active -= amount;
        s.pending += amount;
        uint64 unlockAt = uint64(block.timestamp) + UNSTAKE_DELAY;
        s.unlockAt = unlockAt;
        emit UnstakeStarted(nodeId, amount, unlockAt);
    }

    /// @notice After the cooldown, pay pending stake to the current registry owner of the node.
    /// @param nodeId node id
    function completeUnstake(uint256 nodeId) external nonReentrant {
        Stake storage s = _stakes[nodeId];
        uint256 amount = s.pending;
        if (amount == 0) revert NothingPending();
        if (block.timestamp < s.unlockAt) revert StillLocked();
        s.pending = 0;
        s.unlockAt = 0;
        address to = registry.ownerOf(nodeId);
        spdl.safeTransfer(to, amount);
        emit Unstaked(nodeId, to, amount);
    }

    /// @notice Slash `bps` of (active + pending), taken from active first then pending; slasher only.
    /// @param nodeId node id
    /// @param bps basis points, max 10_000
    /// @param evidenceHash hash of the off-chain evidence
    function slash(uint256 nodeId, uint16 bps, bytes32 evidenceHash) external nonReentrant {
        if (msg.sender != slasher) revert NotSlasher();
        if (bps > 10_000) revert BpsTooHigh();
        Stake storage s = _stakes[nodeId];
        uint256 active = s.active;
        uint256 pending = s.pending;
        uint256 amount = ((active + pending) * bps) / 10_000; // floor: rounds in favour of the node
        uint256 fromActive = amount < active ? amount : active;
        s.active = active - fromActive;
        s.pending = pending - (amount - fromActive);
        if (amount != 0) spdl.safeTransfer(slashRecipient, amount);
        emit Slashed(nodeId, bps, amount, evidenceHash);
    }

    /// @notice Stake state of a node.
    /// @param nodeId node id
    /// @return active staked and not unstaking
    /// @return pending in cooldown (still slashable)
    /// @return unlockAt when pending can be withdrawn
    function stakeOf(uint256 nodeId) external view returns (uint256 active, uint256 pending, uint64 unlockAt) {
        Stake storage s = _stakes[nodeId];
        return (s.active, s.pending, s.unlockAt);
    }

    /// @notice Priority-tier stake minimum for a GPU class (0 for class 0 or out of range).
    /// @param gpuClass class 0..4
    function minStake(uint8 gpuClass) public view returns (uint256) {
        if (gpuClass == 1) return _min1;
        if (gpuClass == 2) return _min2;
        if (gpuClass == 3) return _min3;
        if (gpuClass == 4) return _min4;
        return 0;
    }

    /// @notice True when active stake >= the node's class minimum (the "staked" tier).
    /// @param nodeId node id
    function meetsMinimum(uint256 nodeId) external view returns (bool) {
        return _stakes[nodeId].active >= minStake(registry.getNode(nodeId).gpuClass);
    }
}
