// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {BuyerVault} from "../../src/BuyerVault.sol";
import {IBuyerVault} from "../../src/interfaces/IBuyerVault.sol";
import {Permit2Sig} from "../utils/Permit2Sig.sol";

contract VaultTest is Test, Permit2Sig {
    MockERC20 usdg;
    BuyerVault vault;
    address claims = makeAddr("claims");
    address treasury = makeAddr("treasury");
    address settler = makeAddr("settler");
    uint256 payerKey = 0xA11CE;
    address payer;
    uint256 nonceCtr;

    event SettleFailed(bytes32 indexed paymentId, address indexed payer, bytes4 reason);
    event Settled(bytes32 indexed paymentId, address indexed payer, uint256 used, uint256 surcharge);
    event Deposited(address indexed buyer, address indexed payer, uint256 amount, uint256 toClaims, uint256 toTreasury);

    function setUp() public virtual {
        etchPermit2();
        usdg = new MockERC20("USDG", "USDG", 6);
        vault = new BuyerVault(IERC20(address(usdg)), ISignatureTransfer(PERMIT2_ADDR), claims, treasury, settler);
        payer = vm.addr(payerKey);
        usdg.mint(payer, 1_000_000e6);
        vm.prank(payer);
        usdg.approve(PERMIT2_ADDR, type(uint256).max);
        vm.warp(1_800_000_000);
    }

    function _item(bytes32 id, uint256 cap, uint256 surcharge, uint256 validAfter, uint256 used)
        internal
        returns (IBuyerVault.Settlement memory it)
    {
        ISignatureTransfer.PermitTransferFrom memory p = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdg), amount: cap}),
            nonce: ++nonceCtr,
            deadline: block.timestamp + 1 hours
        });
        it = IBuyerVault.Settlement({
            permit: p,
            payer: payer,
            paymentId: id,
            surcharge: surcharge,
            validAfter: validAfter,
            used: used,
            signature: signWitness(payerKey, p, address(vault), id, surcharge, validAfter)
        });
    }

    function _settle(IBuyerVault.Settlement memory it) internal {
        IBuyerVault.Settlement[] memory a = new IBuyerVault.Settlement[](1);
        a[0] = it;
        vm.prank(settler);
        vault.settle(a);
    }

    function _expectFail(bytes32 id, bytes4 sel) internal {
        vm.expectEmit(true, true, false, true);
        emit SettleFailed(id, payer, sel);
    }

    function _noFunds() internal view {
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    // ---- deposits
    function test_deposit_split8020() public {
        vm.startPrank(payer);
        usdg.approve(address(vault), 1001);
        vm.expectEmit(true, true, false, true);
        emit Deposited(payer, payer, 1001, 800, 201);
        vault.deposit(1001);
        vm.stopPrank();
        assertEq(usdg.balanceOf(claims), 800);
        assertEq(usdg.balanceOf(treasury), 201);
        _noFunds();
    }

    function test_depositFor_creditsBuyer() public {
        address buyer = makeAddr("buyer");
        vm.startPrank(payer);
        usdg.approve(address(vault), 100e6);
        vm.expectEmit(true, true, false, true);
        emit Deposited(buyer, payer, 100e6, 80e6, 20e6);
        vault.depositFor(buyer, 100e6);
        vm.stopPrank();
        assertEq(usdg.balanceOf(payer), 1_000_000e6 - 100e6);
    }

    function test_deposit_zeroReverts() public {
        vm.expectRevert(IBuyerVault.ZeroAmount.selector);
        vault.deposit(0);
        vm.expectRevert(IBuyerVault.ZeroAmount.selector);
        vault.depositFor(payer, 0);
    }

    function testFuzz_depositSplit(uint128 amount) public {
        amount = uint128(bound(amount, 1, 1_000_000e6));
        vm.startPrank(payer);
        usdg.approve(address(vault), amount);
        vault.deposit(amount);
        vm.stopPrank();
        uint256 toClaims = uint256(amount) * 8000 / 10000;
        assertEq(usdg.balanceOf(claims), toClaims);
        assertEq(usdg.balanceOf(treasury), amount - toClaims);
        _noFunds();
    }

    // ---- settle
    function test_settle_exactScheme() public {
        _settle(_item(bytes32(uint256(1)), 1_050_000, 50_000, 0, 1_000_000));
        assertEq(usdg.balanceOf(claims), 800_000);
        assertEq(usdg.balanceOf(treasury), 250_000);
        _noFunds();
    }

    function test_settle_emitsSettled() public {
        vm.expectEmit(true, true, false, true);
        emit Settled(bytes32(uint256(1)), payer, 1_000_000, 50_000);
        _settle(_item(bytes32(uint256(1)), 1_050_000, 50_000, 0, 1_000_000));
    }

    function test_settle_sessionUsedLessThanCap() public {
        _settle(_item(bytes32(uint256(2)), 5_000_000, 20_000, 0, 1_234_567));
        assertEq(usdg.balanceOf(claims), uint256(1_234_567) * 8000 / 10000);
        assertEq(usdg.balanceOf(payer), 1_000_000e6 - 1_234_567 - 20_000);
        _noFunds();
    }

    function test_settle_surchargeToTreasury() public {
        _settle(_item(bytes32(uint256(3)), 1_100, 100, 0, 1_000));
        assertEq(usdg.balanceOf(claims), 800);
        assertEq(usdg.balanceOf(treasury), 200 + 100);
    }

    function test_settle_usedZeroStillTakesSurcharge() public {
        _settle(_item(bytes32(uint256(4)), 100_000, 30_000, 0, 0));
        assertEq(usdg.balanceOf(claims), 0);
        assertEq(usdg.balanceOf(treasury), 30_000);
        _noFunds();
    }

    function test_settle_onlySettler() public {
        IBuyerVault.Settlement[] memory a = new IBuyerVault.Settlement[](1);
        a[0] = _item(bytes32(uint256(5)), 1000, 0, 0, 1000);
        vm.expectRevert(IBuyerVault.NotSettler.selector);
        vault.settle(a);
    }

    function test_settle_tamperedSurchargeFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(6)), 2000, 100, 0, 1000);
        it.surcharge = 50;
        _expectFail(it.paymentId, bytes4(keccak256("InvalidSigner()")));
        _settle(it);
        assertEq(usdg.balanceOf(treasury), 0);
    }

    function test_settle_tamperedPaymentIdFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(7)), 2000, 100, 0, 1000);
        it.paymentId = bytes32(uint256(8));
        _expectFail(it.paymentId, bytes4(keccak256("InvalidSigner()")));
        _settle(it);
        assertEq(usdg.balanceOf(claims), 0);
    }

    function test_settle_overCapFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(9)), 2000, 100, 0, 1901);
        _expectFail(it.paymentId, IBuyerVault.AmountExceedsCap.selector);
        _settle(it);
        assertEq(usdg.balanceOf(claims), 0);
    }

    function test_settle_surchargeAboveCapDoesNotOverflow() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(9)), 2000, 100, 0, 10);
        it.permit.permitted.amount = 50;
        _expectFail(it.paymentId, IBuyerVault.AmountExceedsCap.selector);
        _settle(it);
    }

    function test_settle_wrongTokenFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(9)), 2000, 100, 0, 1000);
        it.permit.permitted.token = address(0xdead);
        _expectFail(it.paymentId, IBuyerVault.WrongToken.selector);
        _settle(it);
    }

    function test_settle_beforeValidAfterFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(10)), 2000, 100, block.timestamp + 100, 1000);
        _expectFail(it.paymentId, IBuyerVault.NotYetValid.selector);
        _settle(it);
        assertEq(usdg.balanceOf(claims), 0);
        vm.warp(block.timestamp + 100);
        _settle(it);
        assertEq(usdg.balanceOf(claims), 800);
    }

    function test_settle_replayFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(11)), 2000, 100, 0, 1000);
        _settle(it);
        _expectFail(it.paymentId, bytes4(keccak256("InvalidNonce()")));
        _settle(it);
        assertEq(usdg.balanceOf(claims), 800);
    }

    function test_settle_expiredDeadlineFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(12)), 2000, 100, 0, 1000);
        vm.warp(it.permit.deadline + 1);
        _expectFail(it.paymentId, bytes4(keccak256("SignatureExpired(uint256)")));
        _settle(it);
    }

    function test_settle_insufficientAllowanceFails() public {
        IBuyerVault.Settlement memory it = _item(bytes32(uint256(13)), 2000, 100, 0, 1000);
        vm.prank(payer);
        usdg.approve(PERMIT2_ADDR, 0);
        // OZ ERC20 reverts with ERC20InsufficientAllowance inside Permit2's SafeTransferLib -> TRANSFER_FROM_FAILED
        vm.expectEmit(true, true, false, false);
        emit SettleFailed(it.paymentId, payer, bytes4(0));
        _settle(it);
        assertEq(usdg.balanceOf(claims), 0);
    }

    function test_settle_batchContinuesAfterFailure() public {
        IBuyerVault.Settlement[] memory a = new IBuyerVault.Settlement[](3);
        a[0] = _item(bytes32(uint256(21)), 1100, 100, 0, 1000);
        a[1] = _item(bytes32(uint256(22)), 1100, 100, 0, 1000);
        a[1].surcharge = 1; // tampered
        a[2] = _item(bytes32(uint256(23)), 1100, 100, 0, 1000);
        vm.expectEmit(true, true, false, true);
        emit Settled(a[0].paymentId, payer, 1000, 100);
        vm.expectEmit(true, true, false, true);
        emit SettleFailed(a[1].paymentId, payer, bytes4(keccak256("InvalidSigner()")));
        vm.expectEmit(true, true, false, true);
        emit Settled(a[2].paymentId, payer, 1000, 100);
        vm.prank(settler);
        vault.settle(a);
        assertEq(usdg.balanceOf(claims), 1600);
        assertEq(usdg.balanceOf(treasury), 2 * 300);
        _noFunds();
    }

    function test_witnessConstants() public view {
        assertEq(vault.SPINDLE_PAYMENT_TYPEHASH(), SPINDLE_PAYMENT_TYPEHASH);
        assertEq(vault.WITNESS_TYPE_STRING(), WITNESS_TYPE_STRING);
    }
}
