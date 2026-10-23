// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISpindleClaims} from "./interfaces/ISpindleClaims.sol";

/// @title SpindleClaims
/// @notice Owner-less cumulative-Merkle payout contract. An immutable poster posts roots, an immutable
///         guardian may veto a root during its delay, and owners claim USDG with a proof.
///         Leaf = keccak256(bytes.concat(keccak256(abi.encode(owner, cumulative)))) (OZ StandardMerkleTree).
contract SpindleClaims is ISpindleClaims, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdg;
    address public immutable poster;
    address public immutable guardian;
    uint256 public immutable maxEpochIncrease;
    uint64 public immutable claimDelay;

    /// @notice Last posted, non-vetoed epoch (0 if none).
    uint64 public lastEpoch;
    uint256 public totalClaimed;
    mapping(uint64 => Root) public roots;
    mapping(address => uint256) public claimed;

    /// @dev All epochs ever posted, ascending (vetoed ones remain; they are skipped on walks).
    uint64[] public postedEpochs;

    constructor(IERC20 usdg_, address poster_, address guardian_, uint256 maxEpochIncrease_, uint64 claimDelay_) {
        usdg = usdg_;
        poster = poster_;
        guardian = guardian_;
        maxEpochIncrease = maxEpochIncrease_;
        claimDelay = claimDelay_;
    }

    /// @notice Post a new cumulative root. Poster only.
    /// @param epoch Strictly greater than `lastEpoch` (gaps allowed).
    /// @param root Merkle root of (owner, cumulative) leaves.
    /// @param totalEarned Sum of all cumulative amounts; bounded by cap and solvency.
    function postRoot(uint64 epoch, bytes32 root, uint256 totalEarned) external {
        if (msg.sender != poster) revert NotPoster();
        if (epoch <= lastEpoch) revert EpochNotIncreasing();
        if (root == bytes32(0)) revert ZeroRoot();
        // A vetoed epoch number may never be reused: roots[epoch] must be empty.
        if (roots[epoch].postedAt != 0) revert EpochNotIncreasing();

        uint256 prevTotal = lastEpoch == 0 ? 0 : roots[lastEpoch].totalEarned;
        if (totalEarned < prevTotal) revert TotalDecreased();
        if (totalEarned - prevTotal > maxEpochIncrease) revert IncreaseTooLarge();
        if (usdg.balanceOf(address(this)) + totalClaimed < totalEarned) revert Insolvent();

        roots[epoch] = Root(root, totalEarned, uint64(block.timestamp), false);
        postedEpochs.push(epoch);
        lastEpoch = epoch;
        emit RootPosted(epoch, root, totalEarned);
    }

    /// @notice Veto a pending root during its delay. Guardian only; cannot move funds.
    function vetoRoot(uint64 epoch) external {
        if (msg.sender != guardian) revert NotGuardian();
        Root storage r = roots[epoch];
        if (r.postedAt == 0) revert UnknownRoot();
        if (r.vetoed) revert RootIsVetoed();
        if (block.timestamp >= uint256(r.postedAt) + claimDelay) revert VetoWindowClosed();
        r.vetoed = true;

        if (epoch == lastEpoch) {
            uint64 prev = 0;
            uint256 i = postedEpochs.length;
            while (i > 0) {
                unchecked {
                    --i;
                }
                uint64 e = postedEpochs[i];
                if (e < epoch && !roots[e].vetoed) {
                    prev = e;
                    break;
                }
            }
            lastEpoch = prev;
        }
        emit RootVetoed(epoch);
    }

    /// @notice Claim USDG against a root. Pays msg.sender.
    /// @param epoch Root to prove against (must be non-vetoed and past its delay).
    /// @param cumulative msg.sender's cumulative earnings in that root.
    /// @param proof Merkle proof.
    /// @param amount Amount to pay now; claimed[msg.sender] + amount <= cumulative.
    function claim(uint64 epoch, uint256 cumulative, bytes32[] calldata proof, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Root storage r = roots[epoch];
        if (r.postedAt == 0) revert UnknownRoot();
        if (r.vetoed) revert RootIsVetoed();
        if (block.timestamp < uint256(r.postedAt) + claimDelay) revert RootNotYetClaimable();

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(msg.sender, cumulative))));
        if (!MerkleProof.verifyCalldata(proof, r.root, leaf)) revert BadProof();

        uint256 newClaimed = claimed[msg.sender] + amount;
        if (newClaimed > cumulative) revert ExceedsCumulative();

        claimed[msg.sender] = newClaimed;
        totalClaimed += amount;
        emit Claimed(msg.sender, epoch, amount, newClaimed);
        usdg.safeTransfer(msg.sender, amount);
    }

    /// @notice Remaining claimable for `owner` given a proven `cumulative`.
    function claimable(address owner, uint256 cumulative) external view returns (uint256) {
        uint256 c = claimed[owner];
        return cumulative > c ? cumulative - c : 0;
    }

    /// @notice Newest non-vetoed root that is past its delay, or 0.
    function latestClaimableEpoch() external view returns (uint64) {
        uint256 i = postedEpochs.length;
        while (i > 0) {
            unchecked {
                --i;
            }
            uint64 e = postedEpochs[i];
            Root storage r = roots[e];
            if (!r.vetoed && block.timestamp >= uint256(r.postedAt) + claimDelay) return e;
        }
        return 0;
    }

    /// @notice Number of epochs ever posted (including vetoed).
    function postedEpochsLength() external view returns (uint256) {
        return postedEpochs.length;
    }
}
