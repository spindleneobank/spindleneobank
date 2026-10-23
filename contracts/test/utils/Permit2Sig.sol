// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {Permit2Code} from "./Permit2Code.sol";

interface IPermit2Domain {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}

/// @notice Etches real Permit2 and signs PermitWitnessTransferFrom with the SpindlePayment witness.
abstract contract Permit2Sig is Test {
    address internal constant PERMIT2_ADDR = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    uint256 internal constant RHC_CHAIN_ID = 4663;

    bytes32 internal constant TOKEN_PERMISSIONS_TYPEHASH = keccak256("TokenPermissions(address token,uint256 amount)");
    string internal constant WITNESS_STUB =
        "PermitWitnessTransferFrom(TokenPermissions permitted,address spender,uint256 nonce,uint256 deadline,";
    string internal constant WITNESS_TYPE_STRING =
        "SpindlePayment witness)SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)TokenPermissions(address token,uint256 amount)";
    bytes32 internal constant SPINDLE_PAYMENT_TYPEHASH =
        keccak256("SpindlePayment(bytes32 paymentId,uint256 surcharge,uint256 validAfter)");

    function etchPermit2() internal {
        vm.chainId(RHC_CHAIN_ID);
        vm.etch(PERMIT2_ADDR, Permit2Code.RUNTIME);
    }

    function witnessHash(bytes32 paymentId, uint256 surcharge, uint256 validAfter) internal pure returns (bytes32) {
        return keccak256(abi.encode(SPINDLE_PAYMENT_TYPEHASH, paymentId, surcharge, validAfter));
    }

    function signWitness(
        uint256 key,
        ISignatureTransfer.PermitTransferFrom memory permit,
        address spender,
        bytes32 paymentId,
        uint256 surcharge,
        uint256 validAfter
    ) internal view returns (bytes memory) {
        bytes32 typeHash = keccak256(abi.encodePacked(WITNESS_STUB, WITNESS_TYPE_STRING));
        bytes32 permHash =
            keccak256(abi.encode(TOKEN_PERMISSIONS_TYPEHASH, permit.permitted.token, permit.permitted.amount));
        bytes32 structHash = keccak256(
            abi.encode(
                typeHash,
                permHash,
                spender,
                permit.nonce,
                permit.deadline,
                witnessHash(paymentId, surcharge, validAfter)
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IPermit2Domain(PERMIT2_ADDR).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
