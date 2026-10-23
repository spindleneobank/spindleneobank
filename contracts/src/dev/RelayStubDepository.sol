// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice DEV / FORK ONLY. Stand-in for Relay's depository so the Relay stub mode (B12) has an
/// on-chain target. Pulls the token from the sender and keeps it. Never deploy to mainnet.
contract RelayStubDepository {
    using SafeERC20 for IERC20;

    event StubDeposit(bytes32 indexed requestId, address indexed sender, address token, uint256 amount);

    function deposit(bytes32 requestId, address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit StubDeposit(requestId, msg.sender, token, amount);
    }
}
