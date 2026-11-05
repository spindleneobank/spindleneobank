// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {IBuyerVault} from "./interfaces/IBuyerVault.sol";

/// @title BuyerVault
/// @notice Owner-less vault. Prepaid deposits and x402 settlements are split 80/20 between
///         SpindleClaims and the treasury on arrival; the vault never retains funds.
contract BuyerVault is IBuyerVault, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    uint16 public constant PROVIDER_BPS = 8000;
    uint16 internal constant BPS = 10_000;

    bytes32 public constant SPINDLE_PAYMENT_TYPEHASH =
        keccak256("SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)");
    string public constant WITNESS_TYPE_STRING =
        "SpindlePayment witness)SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)TokenPermissions(address token,uint256 amount)";

    IERC20 public immutable usdg;
    ISignatureTransfer public immutable permit2;
    address public immutable claims;
    address public immutable treasury;
    address public immutable settler;

    constructor(IERC20 usdg_, ISignatureTransfer permit2_, address claims_, address treasury_, address settler_) {
        usdg = usdg_;
        permit2 = permit2_;
        claims = claims_;
        treasury = treasury_;
        settler = settler_;
    }

    /// @notice Deposit USDG credited to msg.sender; split 80/20 to claims/treasury.
    function deposit(uint256 amount) external nonReentrant {
        _deposit(msg.sender, amount);
    }

    /// @notice Deposit USDG paid by msg.sender and credited to `buyer`.
    function depositFor(address buyer, uint256 amount) external nonReentrant {
        _deposit(buyer, amount);
    }

    /// @notice Settle a batch of buyer-signed Permit2 witness payments. Settler only.
    /// @dev Per-item failures emit SettleFailed and never revert the batch.
    function settle(Settlement[] calldata items) external nonReentrant {
        if (msg.sender != settler) revert NotSettler();
        for (uint256 i; i < items.length; ++i) {
            _settleOne(items[i]);
        }
    }

    function _deposit(address buyer, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        uint256 toClaims = amount * PROVIDER_BPS / BPS;
        uint256 toTreasury = amount - toClaims;
        usdg.safeTransfer(claims, toClaims);
        if (toTreasury != 0) usdg.safeTransfer(treasury, toTreasury);
        emit Deposited(buyer, msg.sender, amount, toClaims, toTreasury);
    }

    function _settleOne(Settlement calldata it) internal {
        bytes4 pre = _precheck(it);
        if (pre != 0) {
            emit SettleFailed(it.paymentId, it.payer, pre);
            return;
        }
        uint256 requested = it.used + it.surcharge;
        bytes32 witness = keccak256(abi.encode(SPINDLE_PAYMENT_TYPEHASH, it.paymentId, it.surcharge, it.validAfter));
        try permit2.permitWitnessTransferFrom(
            it.permit,
            ISignatureTransfer.SignatureTransferDetails({to: address(this), requestedAmount: requested}),
            it.payer,
            witness,
            WITNESS_TYPE_STRING,
            it.signature
        ) {
            uint256 toClaims = it.used * PROVIDER_BPS / BPS;
            if (toClaims != 0) usdg.safeTransfer(claims, toClaims);
            uint256 toTreasury = it.used - toClaims + it.surcharge;
            if (toTreasury != 0) usdg.safeTransfer(treasury, toTreasury);
            emit Settled(it.paymentId, it.payer, it.used, it.surcharge);
        } catch (bytes memory reason) {
            bytes4 sel;
            if (reason.length >= 4) {
                assembly ("memory-safe") {
                    sel := mload(add(reason, 0x20))
                }
            }
            emit SettleFailed(it.paymentId, it.payer, sel);
        }
    }

    function _precheck(Settlement calldata it) internal view returns (bytes4) {
        if (it.permit.permitted.token != address(usdg)) return WrongToken.selector;
        uint256 cap = it.permit.permitted.amount;
        if (it.surcharge > cap || it.used > cap - it.surcharge) return AmountExceedsCap.selector;
        if (block.timestamp < it.validAfter) return NotYetValid.selector;
        return 0;
    }
}
