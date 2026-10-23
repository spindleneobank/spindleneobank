// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {BuyerVault} from "../../src/BuyerVault.sol";
import {IBuyerVault} from "../../src/interfaces/IBuyerVault.sol";
import {Permit2Sig} from "../utils/Permit2Sig.sol";

contract VaultHandler is Test, Permit2Sig {
    MockERC20 public usdg;
    BuyerVault public vault;
    address public settler;
    uint256 public payerKey = 0xB0B;
    address public payer;
    uint256 public nonceCtr;
    uint256 public sumAmounts; // deposits + settled used
    uint256 public sumFloor80; // sum floor(0.8 * amount) per deposit/settlement
    uint256 public sumSurcharge;

    constructor(MockERC20 u, BuyerVault v, address s) {
        usdg = u;
        vault = v;
        settler = s;
        payer = vm.addr(payerKey);
        u.mint(payer, type(uint128).max);
        vm.startPrank(payer);
        u.approve(address(v), type(uint256).max);
        u.approve(PERMIT2_ADDR, type(uint256).max);
        vm.stopPrank();
    }

    function deposit(uint128 amount) external {
        amount = uint128(bound(amount, 1, 1_000_000e6));
        vm.prank(payer);
        vault.deposit(amount);
        sumAmounts += amount;
        sumFloor80 += uint256(amount) * 8000 / 10000;
    }

    /// @dev mode 0 valid, 1 tampered surcharge, 2 over cap, 3 replay
    function settle(uint128 used, uint64 surcharge, uint8 mode) external {
        used = uint128(bound(used, 0, 1_000_000e6));
        surcharge = uint64(bound(surcharge, 0, 1_000_000));
        mode = mode % 4;
        uint256 cap = uint256(used) + surcharge;
        bytes32 id = bytes32(++nonceCtr);
        ISignatureTransfer.PermitTransferFrom memory p = ISignatureTransfer.PermitTransferFrom({
            permitted: ISignatureTransfer.TokenPermissions({token: address(usdg), amount: cap}),
            nonce: nonceCtr,
            deadline: block.timestamp + 1 hours
        });
        IBuyerVault.Settlement memory it = IBuyerVault.Settlement({
            permit: p,
            payer: payer,
            paymentId: id,
            surcharge: surcharge,
            validAfter: 0,
            used: used,
            signature: signWitness(payerKey, p, address(vault), id, surcharge, 0)
        });
        bool ok = true;
        if (mode == 1) {
            it.surcharge = uint256(surcharge) + 1;
            ok = false;
        } else if (mode == 2) {
            it.used = uint256(used) + 1;
            ok = false;
        }
        IBuyerVault.Settlement[] memory a = new IBuyerVault.Settlement[](mode == 3 ? 2 : 1);
        a[0] = it;
        if (mode == 3) a[1] = it;
        vm.prank(settler);
        vault.settle(a);
        if (ok) {
            sumAmounts += used;
            sumFloor80 += uint256(used) * 8000 / 10000;
            sumSurcharge += surcharge;
        }
    }
}

contract VaultInvariantTest is StdInvariant, Test, Permit2Sig {
    MockERC20 usdg;
    BuyerVault vault;
    VaultHandler handler;
    address claims = makeAddr("claims");
    address treasury = makeAddr("treasury");
    address settler = makeAddr("settler");

    function setUp() public {
        etchPermit2();
        usdg = new MockERC20("USDG", "USDG", 6);
        vault = new BuyerVault(IERC20(address(usdg)), ISignatureTransfer(PERMIT2_ADDR), claims, treasury, settler);
        handler = new VaultHandler(usdg, vault, settler);
        targetContract(address(handler));
    }

    function invariant_vaultHoldsNothing() public view {
        assertEq(usdg.balanceOf(address(vault)), 0);
    }

    function invariant_claimsGetsFloor80() public view {
        assertEq(usdg.balanceOf(claims), handler.sumFloor80());
    }

    function invariant_treasuryGetsRemainderPlusSurcharge() public view {
        assertEq(usdg.balanceOf(treasury), handler.sumAmounts() - handler.sumFloor80() + handler.sumSurcharge());
    }
}
