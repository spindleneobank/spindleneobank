// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {BuyerVault} from "../../src/BuyerVault.sol";
import {IBuyerVault} from "../../src/interfaces/IBuyerVault.sol";
import {Permit2Sig} from "../utils/Permit2Sig.sol";

/// @notice Real USDG + real Permit2 on RHC. Measures settle gas and prints the JSON for gas/settle-gas.json.
contract VaultForkTest is Test, Permit2Sig {
    IERC20 constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address constant POOL = 0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a;
    uint256 constant FORK_BLOCK = 95_810_209;

    BuyerVault vault;
    address claims = makeAddr("claims");
    address treasury = makeAddr("treasury");
    address settler = makeAddr("settler");
    uint256 payerKey = 0xC0FFEE;
    address payer;
    uint256 nonceCtr;

    function setUp() public {
        vm.createSelectFork(vm.envString("RHC_RPC_URL"), FORK_BLOCK);
        vault = new BuyerVault(USDG, ISignatureTransfer(PERMIT2_ADDR), claims, treasury, settler);
        payer = vm.addr(payerKey);
        vm.prank(POOL);
        USDG.transfer(payer, 10_000e6);
        vm.prank(payer);
        USDG.approve(PERMIT2_ADDR, type(uint256).max);
    }

    function _items(uint256 n) internal returns (IBuyerVault.Settlement[] memory a) {
        a = new IBuyerVault.Settlement[](n);
        for (uint256 i; i < n; ++i) {
            bytes32 id = keccak256(abi.encode("pay", ++nonceCtr));
            ISignatureTransfer.PermitTransferFrom memory p = ISignatureTransfer.PermitTransferFrom({
                permitted: ISignatureTransfer.TokenPermissions({token: address(USDG), amount: 1_050_000}),
                nonce: nonceCtr,
                deadline: block.timestamp + 1 hours
            });
            a[i] = IBuyerVault.Settlement({
                permit: p,
                payer: payer,
                paymentId: id,
                surcharge: 50_000,
                validAfter: 0,
                used: 1_000_000,
                signature: signWitness(payerKey, p, address(vault), id, 50_000, 0)
            });
        }
    }

    function _measure(uint256 n) internal returns (uint256 g) {
        IBuyerVault.Settlement[] memory a = _items(n);
        uint256 c0 = USDG.balanceOf(claims);
        vm.prank(settler);
        uint256 before = gasleft();
        vault.settle(a);
        g = before - gasleft();
        assertEq(USDG.balanceOf(claims) - c0, n * 800_000);
        assertEq(USDG.balanceOf(address(vault)), 0);
    }

    function test_fork_settleGas() public {
        assertEq(block.chainid, 4663);
        // Warm the payer/treasury/claims balance slots with a first deposit-free settle so that
        // batch measurements reflect steady state (first-ever recipient writes are SSTORE zero->nonzero).
        uint256 b1 = _measure(1);
        uint256 b5 = _measure(5);
        uint256 b25 = _measure(25);
        uint256 perItem = (b25 - b5) / 20;
        uint256 base = b25 - perItem * 25;
        console.log("GASJSON");
        console.log(
            string.concat(
                '{ "perItem": ',
                vm.toString(perItem),
                ', "base": ',
                vm.toString(base),
                ', "batch1": ',
                vm.toString(b1),
                ', "batch5": ',
                vm.toString(b5),
                ', "batch25": ',
                vm.toString(b25),
                ', "forkBlock": ',
                vm.toString(FORK_BLOCK),
                ', "measuredAt": "2026-10-23" }'
            )
        );
        assertGt(perItem, 0);
    }
}
