// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SpindleRegistry} from "../../src/SpindleRegistry.sol";
import {SpindleStaking} from "../../src/SpindleStaking.sol";
import {ISpindleStaking} from "../../src/interfaces/ISpindleStaking.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {MockIdentity} from "../../src/mocks/MockIdentity.sol";

contract StakingTest is Test {
    SpindleRegistry reg;
    SpindleStaking st;
    MockERC20 spdl;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address slasher = makeAddr("slasher");
    address sink = makeAddr("sink");
    uint256 nodePk = 0xA11CE;
    uint256 nid;

    function setUp() public {
        spdl = new MockERC20("Spindle", "SPDL", 18);
        reg = new SpindleRegistry(address(new MockIdentity()));
        st = new SpindleStaking(spdl, reg, slasher, sink, 1000e18, 2500e18, 10_000e18, 25_000e18);
        nid = _register(alice, 2);
        spdl.mint(alice, 1_000_000e18);
        vm.prank(alice);
        spdl.approve(address(st), type(uint256).max);
    }

    function _register(address owner, uint8 cls) internal returns (uint256) {
        address key = vm.addr(nodePk);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 sh = keccak256(abi.encode(reg.NODE_BINDING_TYPEHASH(), owner, key, cls, false, dl));
        bytes32 dom = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SpindleRegistry"),
                keccak256("1"),
                block.chainid,
                address(reg)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(nodePk, keccak256(abi.encodePacked("\x19\x01", dom, sh)));
        vm.prank(owner);
        return reg.registerNode(key, cls, false, bytes32(0), dl, abi.encodePacked(r, s, v));
    }

    function test_stake_onlyOwner() public {
        spdl.mint(bob, 10e18);
        vm.startPrank(bob);
        spdl.approve(address(st), 10e18);
        vm.expectRevert(ISpindleStaking.NotNodeOwner.selector);
        st.stake(nid, 10e18);
        vm.stopPrank();

        vm.expectEmit(true, true, false, true);
        emit ISpindleStaking.Staked(nid, alice, 5e18);
        vm.prank(alice);
        st.stake(nid, 5e18);
        (uint256 a,,) = st.stakeOf(nid);
        assertEq(a, 5e18);
        assertEq(spdl.balanceOf(address(st)), 5e18);
    }

    function test_stake_revertsInactive() public {
        vm.startPrank(alice);
        reg.deactivate(nid);
        vm.expectRevert(ISpindleStaking.NodeNotActive.selector);
        st.stake(nid, 1e18);
        vm.stopPrank();
    }

    function test_unstake_delay() public {
        vm.startPrank(alice);
        st.stake(nid, 100e18);
        st.beginUnstake(nid, 40e18);
        (uint256 a, uint256 p, uint64 u) = st.stakeOf(nid);
        assertEq(a, 60e18);
        assertEq(p, 40e18);
        assertEq(u, block.timestamp + 7 days);

        vm.expectRevert(ISpindleStaking.StillLocked.selector);
        st.completeUnstake(nid);
        vm.warp(u - 1);
        vm.expectRevert(ISpindleStaking.StillLocked.selector);
        st.completeUnstake(nid);

        uint256 before = spdl.balanceOf(alice);
        vm.warp(u);
        st.completeUnstake(nid);
        vm.stopPrank();
        assertEq(spdl.balanceOf(alice) - before, 40e18);
        (, p,) = st.stakeOf(nid);
        assertEq(p, 0);
        vm.expectRevert(ISpindleStaking.NothingPending.selector);
        st.completeUnstake(nid);
    }

    function test_unstake_resetsUnlock() public {
        vm.startPrank(alice);
        st.stake(nid, 100e18);
        st.beginUnstake(nid, 10e18);
        vm.warp(block.timestamp + 3 days);
        st.beginUnstake(nid, 10e18);
        (, uint256 p, uint64 u) = st.stakeOf(nid);
        assertEq(p, 20e18);
        assertEq(u, block.timestamp + 7 days);
        vm.expectRevert(ISpindleStaking.InsufficientStake.selector);
        st.beginUnstake(nid, 81e18);
        vm.stopPrank();
        vm.prank(bob);
        vm.expectRevert(ISpindleStaking.NotNodeOwner.selector);
        st.beginUnstake(nid, 1);
    }

    function test_unstake_allowedAfterDeactivate() public {
        vm.startPrank(alice);
        st.stake(nid, 10e18);
        reg.deactivate(nid);
        st.beginUnstake(nid, 10e18);
        vm.warp(block.timestamp + 7 days);
        st.completeUnstake(nid);
        vm.stopPrank();
        assertEq(spdl.balanceOf(address(st)), 0);
    }

    function test_slash_onlySlasher() public {
        vm.prank(alice);
        st.stake(nid, 100e18);
        vm.prank(alice);
        vm.expectRevert(ISpindleStaking.NotSlasher.selector);
        st.slash(nid, 100, bytes32(0));
        vm.prank(bob);
        vm.expectRevert(ISpindleStaking.NotSlasher.selector);
        st.slash(nid, 100, bytes32(0));

        vm.expectEmit(true, false, false, true);
        emit ISpindleStaking.Slashed(nid, 1000, 10e18, bytes32(uint256(9)));
        vm.prank(slasher);
        st.slash(nid, 1000, bytes32(uint256(9)));
        assertEq(spdl.balanceOf(sink), 10e18);
    }

    function test_slash_proRataActivePending() public {
        vm.startPrank(alice);
        st.stake(nid, 100e18);
        st.beginUnstake(nid, 30e18); // active 70, pending 30
        vm.stopPrank();
        // 50% of 100 = 50: active first (70 -> 20), pending untouched
        vm.prank(slasher);
        st.slash(nid, 5000, bytes32(0));
        (uint256 a, uint256 p,) = st.stakeOf(nid);
        assertEq(a, 20e18);
        assertEq(p, 30e18);
        // 60% of 50 = 30: active 20 gone, 10 from pending
        vm.prank(slasher);
        st.slash(nid, 6000, bytes32(0));
        (a, p,) = st.stakeOf(nid);
        assertEq(a, 0);
        assertEq(p, 20e18);
        assertEq(spdl.balanceOf(sink), 80e18);
        assertEq(spdl.balanceOf(address(st)), 20e18);
    }

    function test_slash_roundsDownForNode() public {
        vm.prank(alice);
        st.stake(nid, 3);
        vm.prank(slasher);
        st.slash(nid, 3333, bytes32(0)); // 3*3333/10000 = 0
        (uint256 a,,) = st.stakeOf(nid);
        assertEq(a, 3);
    }

    function test_slash_bpsMax() public {
        vm.prank(alice);
        st.stake(nid, 100e18);
        vm.prank(slasher);
        vm.expectRevert(ISpindleStaking.BpsTooHigh.selector);
        st.slash(nid, 10_001, bytes32(0));
        vm.prank(slasher);
        st.slash(nid, 10_000, bytes32(0));
        (uint256 a, uint256 p,) = st.stakeOf(nid);
        assertEq(a + p, 0);
        assertEq(spdl.balanceOf(sink), 100e18);
    }

    function test_meetsMinimum_perClass() public {
        assertEq(st.minStake(0), 0);
        assertEq(st.minStake(1), 1000e18);
        assertEq(st.minStake(2), 2500e18);
        assertEq(st.minStake(3), 10_000e18);
        assertEq(st.minStake(4), 25_000e18);
        assertFalse(st.meetsMinimum(nid));
        vm.startPrank(alice);
        st.stake(nid, 2500e18);
        assertTrue(st.meetsMinimum(nid));
        st.beginUnstake(nid, 1);
        assertFalse(st.meetsMinimum(nid)); // only active counts
        vm.stopPrank();
    }

    function testFuzz_stakeUnstake(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1_000_000e18));
        vm.startPrank(alice);
        uint256 before = spdl.balanceOf(alice);
        st.stake(nid, amount);
        st.beginUnstake(nid, amount);
        vm.warp(block.timestamp + 7 days);
        st.completeUnstake(nid);
        vm.stopPrank();
        assertEq(spdl.balanceOf(alice), before);
        assertEq(spdl.balanceOf(address(st)), 0);
    }
}
