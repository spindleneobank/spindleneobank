// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal slice of the ERC-8004 IdentityRegistry (an ERC-721) that Spindle relies on.
interface IERC8004Identity {
    /// @notice Owner of the agent identity token. Reverts for unminted ids.
    function ownerOf(uint256 agentId) external view returns (address);
}
