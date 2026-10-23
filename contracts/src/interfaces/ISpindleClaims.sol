// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISpindleClaims {
    struct Root {
        bytes32 root;
        uint256 totalEarned;
        uint64 postedAt;
        bool vetoed;
    }

    error NotPoster();
    error NotGuardian();
    error EpochNotIncreasing();
    error ZeroRoot();
    error TotalDecreased();
    error IncreaseTooLarge();
    error Insolvent();
    error UnknownRoot();
    error RootIsVetoed();
    error RootNotYetClaimable();
    error VetoWindowClosed();
    error BadProof();
    error ExceedsCumulative();
    error ZeroAmount();

    event RootPosted(uint64 indexed epoch, bytes32 root, uint256 totalEarned);
    event RootVetoed(uint64 indexed epoch);
    event Claimed(address indexed owner, uint64 indexed epoch, uint256 amount, uint256 claimedTotal);

    function lastEpoch() external view returns (uint64);
    function totalClaimed() external view returns (uint256);
    function roots(uint64 epoch) external view returns (bytes32 root, uint256 totalEarned, uint64 postedAt, bool vetoed);
    function claimed(address owner) external view returns (uint256);

    function postRoot(uint64 epoch, bytes32 root, uint256 totalEarned) external;
    function vetoRoot(uint64 epoch) external;
    function claim(uint64 epoch, uint256 cumulative, bytes32[] calldata proof, uint256 amount) external;
    function claimable(address owner, uint256 cumulative) external view returns (uint256);
    function latestClaimableEpoch() external view returns (uint64);
}
