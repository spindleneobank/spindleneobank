// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";

/// @notice Prepaid deposits and x402 Permit2 settlement with an on-chain 80/20 split.
interface IBuyerVault {
    /// @param permit Permit2 permit; `permitted.token` must be USDG and `permitted.amount` is the cap.
    /// @param payer Signer of the permit.
    /// @param paymentId Gateway payment id (bound in the witness).
    /// @param surcharge Surcharge in USDG micros (bound in the witness), routed only to the treasury.
    /// @param validAfter Earliest settlement timestamp (bound in the witness).
    /// @param used Price actually charged (<= cap - surcharge); chosen by the settler.
    /// @param signature Payer's Permit2 witness signature.
    struct Settlement {
        ISignatureTransfer.PermitTransferFrom permit;
        address payer;
        bytes32 paymentId;
        uint256 surcharge;
        uint256 validAfter;
        uint256 used;
        bytes signature;
    }

    event Deposited(address indexed buyer, address indexed payer, uint256 amount, uint256 toClaims, uint256 toTreasury);
    event Settled(bytes32 indexed paymentId, address indexed payer, uint256 used, uint256 surcharge);
    event SettleFailed(bytes32 indexed paymentId, address indexed payer, bytes4 reason);

    error NotSettler();
    error ZeroAmount();
    error WrongToken();
    error AmountExceedsCap();
    error NotYetValid();

    function deposit(uint256 amount) external;
    function depositFor(address buyer, uint256 amount) external;
    function settle(Settlement[] calldata items) external;
}
