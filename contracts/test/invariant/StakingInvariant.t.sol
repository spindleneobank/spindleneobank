// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {SpindleRegistry} from "../../src/SpindleRegistry.sol";
import {SpindleStaking} from "../../src/SpindleStaking.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockIdentity} from "../../src/mocks/MockIdentity.sol";

contract StakingHandler is Test {
    SpindleRegistry public reg;
    SpindleStaking public st;
    MockERC20 public spdl;
    address public slasher;
    uint256[] public nodeIds;
    address[] public owners;
    uint256 public earlyCompleteSucceeded;
    uint256 public nonSlasherSucceeded;

    constructor(SpindleRegistry r, SpindleStaking s, MockERC20 t, address slasher_) {
        reg = r;
        st = s;
        spdl = t;
        slasher = slasher_;
        for (uint256 i = 0; i < 3; i++) {
            uint256 pk = 0x1000 + i;
            address owner = vm.addr(0x2000 + i);
            address key = vm.addr(pk);
            uint256 dl = block.timestamp + 365 days;
            bytes32 sh = keccak256(abi.encode(reg.NODE_BINDING_TYPEHASH(), owner, key, uint8(1 + i), false, dl));
            bytes32 dom = keccak256(
                abi.encode(
                    keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                    keccak256("SpindleRegistry"),
                    keccak256("1"),
                    block.chainid,
                    address(reg)
                )
            );
            (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", dom, sh)));
            vm.prank(owner);
            nodeIds.push(reg.registerNode(key, uint8(1 + i), false, 0, dl, abi.encodePacked(rr, ss, v)));
            owners.push(owner);
            spdl.mint(owner, type(uint96).max);
            vm.prank(owner);
            spdl.approve(address(st), type(uint256).max);
        }
    }

    function stake(uint256 i, uint96 amt) external {
        i %= 3;
        amt = uint96(bound(amt, 1, 1_000_000e18));
        vm.prank(owners[i]);
        st.stake(nodeIds[i], amt);
    }

    function beginUnstake(uint256 i, uint96 amt) external {
        i %= 3;
        (uint256 a,,) = st.stakeOf(nodeIds[i]);
        if (a == 0) return;
        amt = uint96(bound(amt, 1, a));
        vm.prank(owners[i]);
        st.beginUnstake(nodeIds[i], amt);
    }

    function complete(uint256 i, bool warp) external {
        i %= 3;
        (, uint256 p, uint64 u) = st.stakeOf(nodeIds[i]);
        if (p == 0) return;
        if (warp) vm.warp(u);
        bool early = block.timestamp < u;
        try st.completeUnstake(nodeIds[i]) {
            if (early) earlyCompleteSucceeded++;
        } catch {}
    }

    function slash(uint256 i, uint16 bps, bool asSlasher) external {
        i %= 3;
        bps = uint16(bound(bps, 0, 12_000));
        vm.prank(asSlasher ? slasher : address(0xBAD));
        try st.slash(nodeIds[i], bps, bytes32(0)) {
            if (!asSlasher) nonSlasherSucceeded++;
            assertLe(bps, 10_000);
        } catch {}
    }

    function sumStakes() external view returns (uint256 total) {
        for (uint256 i = 0; i < 3; i++) {
            (uint256 a, uint256 p,) = st.stakeOf(nodeIds[i]);
            total += a + p;
        }
    }
}

contract StakingInvariantTest is StdInvariant, Test {
    StakingHandler h;
    SpindleStaking st;
    MockERC20 spdl;

    function setUp() public {
        spdl = new MockERC20("Spindle", "SPDL", 18);
        SpindleRegistry reg = new SpindleRegistry(address(new MockIdentity()));
        address slasher = makeAddr("slasher");
        st = new SpindleStaking(spdl, reg, slasher, makeAddr("sink"), 5e17, 1e18, 2e18, 3e18, 4e18);
        h = new StakingHandler(reg, st, spdl, slasher);
        targetContract(address(h));
    }

    /// Invariant 3: token balance == sum(active + pending)
    function invariant_balanceEqualsStakes() public view {
        assertEq(spdl.balanceOf(address(st)), h.sumStakes());
    }

    /// Invariant 5: completeUnstake before unlockAt never succeeds
    function invariant_noEarlyComplete() public view {
        assertEq(h.earlyCompleteSucceeded(), 0);
    }

    /// Invariant 4: non-slasher never slashes
    function invariant_onlySlasher() public view {
        assertEq(h.nonSlasherSucceeded(), 0);
    }
}
