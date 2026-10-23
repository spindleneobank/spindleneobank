// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Test-only minimal ERC-8004-like identity registry. `mint` has no access control.
contract MockIdentity is ERC721 {
    uint256 public nextId = 1;

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function mint(address to) external returns (uint256 id) {
        id = nextId++;
        _mint(to, id);
    }
}
