// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {SpindleClaims} from "../../src/SpindleClaims.sol";
import {ISpindleClaims} from "../../src/interfaces/ISpindleClaims.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

library TwoLeaf {
    function leaf(address o, uint256 c) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(o, c))));
    }

    function hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function root(address a, uint256 ca, address b, uint256 cb) internal pure returns (bytes32) {
        return hashPair(leaf(a, ca), leaf(b, cb));
    }

    function proofA(address b, uint256 cb) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = leaf(b, cb);
    }
}

contract ClaimsTest is Test {
    MockERC20 usdg;
    SpindleClaims claims;

    address poster = makeAddr("poster");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant CAP = 5_000e6;
    uint64 constant DELAY = 3600;

    function setUp() public {
        usdg = new MockERC20("USDG", "USDG", 6);
        claims = new SpindleClaims(usdg, poster, guardian, CAP, DELAY);
        usdg.mint(address(claims), 100_000e6);
        vm.warp(1_000_000);
    }

    function _post(uint64 epoch, uint256 ca, uint256 cb) internal returns (bytes32 r) {
        r = TwoLeaf.root(alice, ca, bob, cb);
        vm.prank(poster);
        claims.postRoot(epoch, r, ca + cb);
    }

    function _claimAlice(uint64 epoch, uint256 cum, uint256 cumBob, uint256 amount) internal {
        vm.prank(alice);
        claims.claim(epoch, cum, TwoLeaf.proofA(bob, cumBob), amount);
    }

    // ---- postRoot ----
    function test_postRoot_happy() public {
        bytes32 r = _post(1, 100e6, 50e6);
        (bytes32 root, uint256 total, uint64 at, bool vetoed) = claims.roots(1);
        assertEq(root, r);
        assertEq(total, 150e6);
        assertEq(at, block.timestamp);
        assertFalse(vetoed);
        assertEq(claims.lastEpoch(), 1);
    }

    function test_postRoot_onlyPoster() public {
        vm.expectRevert(ISpindleClaims.NotPoster.selector);
        claims.postRoot(1, bytes32(uint256(1)), 1);
    }

    function test_postRoot_epochMustIncrease() public {
        _post(5, 1e6, 1e6);
        vm.startPrank(poster);
        vm.expectRevert(ISpindleClaims.EpochNotIncreasing.selector);
        claims.postRoot(5, bytes32(uint256(1)), 2e6);
        vm.expectRevert(ISpindleClaims.EpochNotIncreasing.selector);
        claims.postRoot(4, bytes32(uint256(1)), 2e6);
        vm.expectRevert(ISpindleClaims.ZeroRoot.selector);
        claims.postRoot(6, bytes32(0), 2e6);
        vm.stopPrank();
        _post(9, 2e6, 1e6); // gaps allowed
    }

    function test_postRoot_capEnforced() public {
        vm.startPrank(poster);
        vm.expectRevert(ISpindleClaims.IncreaseTooLarge.selector);
        claims.postRoot(1, bytes32(uint256(1)), CAP + 1);
        claims.postRoot(1, bytes32(uint256(1)), CAP);
        vm.expectRevert(ISpindleClaims.IncreaseTooLarge.selector);
        claims.postRoot(2, bytes32(uint256(2)), CAP + CAP + 1);
        claims.postRoot(2, bytes32(uint256(2)), CAP + CAP);
        vm.stopPrank();
    }

    function test_postRoot_totalCannotDecrease() public {
        _post(1, 100e6, 50e6);
        vm.prank(poster);
        vm.expectRevert(ISpindleClaims.TotalDecreased.selector);
        claims.postRoot(2, bytes32(uint256(1)), 149e6);
    }

    function test_postRoot_insolventReverts() public {
        SpindleClaims c = new SpindleClaims(usdg, poster, guardian, 1_000_000e6, DELAY);
        usdg.mint(address(c), 1000e6);
        vm.startPrank(poster);
        vm.expectRevert(ISpindleClaims.Insolvent.selector);
        c.postRoot(1, bytes32(uint256(1)), 1000e6 + 1);
        c.postRoot(1, bytes32(uint256(1)), 1000e6);
        vm.stopPrank();
    }

    // ---- claim ----
    function test_claim_afterDelay() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _claimAlice(1, 100e6, 50e6, 100e6);
        assertEq(usdg.balanceOf(alice), 100e6);
        assertEq(claims.claimed(alice), 100e6);
        assertEq(claims.totalClaimed(), 100e6);
        assertEq(claims.latestClaimableEpoch(), 1);
    }

    function test_claim_beforeDelayReverts() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY - 1);
        assertEq(claims.latestClaimableEpoch(), 0);
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.RootNotYetClaimable.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
    }

    function test_claim_vetoedReverts() public {
        _post(1, 100e6, 50e6);
        vm.prank(guardian);
        claims.vetoRoot(1);
        vm.warp(block.timestamp + DELAY);
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.RootIsVetoed.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
        assertEq(claims.latestClaimableEpoch(), 0);
    }

    function test_claim_partialThenRest() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _claimAlice(1, 100e6, 50e6, 30e6);
        assertEq(claims.claimable(alice, 100e6), 70e6);
        _claimAlice(1, 100e6, 50e6, 70e6);
        assertEq(claims.claimable(alice, 100e6), 0);
        assertEq(usdg.balanceOf(alice), 100e6);
    }

    function test_claim_exceedsCumulativeReverts() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _claimAlice(1, 100e6, 50e6, 100e6);
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.ExceedsCumulative.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.ZeroAmount.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 0);
    }

    function test_claim_badProof() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        vm.startPrank(alice);
        // inflated cumulative
        vm.expectRevert(ISpindleClaims.BadProof.selector);
        claims.claim(1, 200e6, TwoLeaf.proofA(bob, 50e6), 150e6);
        // wrong sender
        vm.stopPrank();
        vm.prank(makeAddr("mallory"));
        vm.expectRevert(ISpindleClaims.BadProof.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
        // unknown root
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.UnknownRoot.selector);
        claims.claim(7, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
    }

    function test_claim_olderRootStillValid() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _post(2, 300e6, 50e6);
        // older root claimable while newer pending
        _claimAlice(1, 100e6, 50e6, 100e6);
        vm.warp(block.timestamp + DELAY);
        // newer root pays only the difference (global claimed)
        _claimAlice(2, 300e6, 50e6, 200e6);
        vm.prank(alice);
        vm.expectRevert(ISpindleClaims.ExceedsCumulative.selector);
        claims.claim(1, 100e6, TwoLeaf.proofA(bob, 50e6), 1);
        assertEq(usdg.balanceOf(alice), 300e6);
        assertEq(claims.latestClaimableEpoch(), 2);
    }

    // ---- veto ----
    function test_veto_onlyGuardian() public {
        _post(1, 100e6, 50e6);
        vm.prank(poster);
        vm.expectRevert(ISpindleClaims.NotGuardian.selector);
        claims.vetoRoot(1);
        vm.prank(guardian);
        vm.expectRevert(ISpindleClaims.UnknownRoot.selector);
        claims.vetoRoot(2);
    }

    function test_veto_afterWindowReverts() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        vm.prank(guardian);
        vm.expectRevert(ISpindleClaims.VetoWindowClosed.selector);
        claims.vetoRoot(1);
    }

    function test_veto_rollsBackLastEpoch() public {
        _post(1, 100e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _post(2, 200e6, 50e6);
        vm.prank(guardian);
        claims.vetoRoot(2);
        assertEq(claims.lastEpoch(), 1);
        vm.prank(guardian);
        vm.expectRevert(ISpindleClaims.RootIsVetoed.selector);
        claims.vetoRoot(2);
        // veto of the only root rolls back to 0
        SpindleClaims c = new SpindleClaims(usdg, poster, guardian, CAP, DELAY);
        usdg.mint(address(c), 10e6);
        vm.prank(poster);
        c.postRoot(1, bytes32(uint256(1)), 10e6);
        vm.prank(guardian);
        c.vetoRoot(1);
        assertEq(c.lastEpoch(), 0);
    }

    function test_repostAfterVeto() public {
        _post(1, 100e6, 50e6);
        vm.prank(guardian);
        claims.vetoRoot(1);
        // same epoch number cannot be reused
        vm.prank(poster);
        vm.expectRevert(ISpindleClaims.EpochNotIncreasing.selector);
        claims.postRoot(1, bytes32(uint256(1)), 1);
        _post(2, 80e6, 50e6);
        vm.warp(block.timestamp + DELAY);
        _claimAlice(2, 80e6, 50e6, 80e6);
        assertEq(claims.latestClaimableEpoch(), 2);
    }

    // ---- JS vector ----
    function test_jsVectorMatches() public {
        string memory json = vm.readFile("test/fixtures/merkle-vector.json");
        bytes32 root = vm.parseJsonBytes32(json, ".root");
        uint256 total = vm.parseJsonUint(json, ".totalEarned");
        SpindleClaims c = new SpindleClaims(usdg, poster, guardian, total, DELAY);
        usdg.mint(address(c), total);
        vm.prank(poster);
        c.postRoot(1, root, total);
        vm.warp(block.timestamp + DELAY);

        for (uint256 i; i < 5; ++i) {
            string memory p = string.concat(".leaves[", vm.toString(i), "]");
            address owner = vm.parseJsonAddress(json, string.concat(p, ".owner"));
            uint256 cum = vm.parseJsonUint(json, string.concat(p, ".cumulative"));
            bytes32 jsLeaf = vm.parseJsonBytes32(json, string.concat(p, ".leaf"));
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, string.concat(p, ".proof"));
            assertEq(TwoLeaf.leaf(owner, cum), jsLeaf, "leaf");
            assertTrue(MerkleProof.verify(proof, root, jsLeaf), "proof");
            vm.prank(owner);
            c.claim(1, cum, proof, cum);
            assertEq(usdg.balanceOf(owner), cum);
        }
        assertEq(c.totalClaimed(), total);
    }

    // ---- gas ----
    function test_gas_postAndClaim() public {
        bytes32 r = TwoLeaf.root(alice, 100e6, bob, 50e6);
        vm.prank(poster);
        uint256 g = gasleft();
        claims.postRoot(1, r, 150e6);
        emit log_named_uint("postRoot gas", g - gasleft());
        vm.warp(block.timestamp + DELAY);
        bytes32[] memory proof = TwoLeaf.proofA(bob, 50e6);
        vm.prank(alice);
        g = gasleft();
        claims.claim(1, 100e6, proof, 100e6);
        emit log_named_uint("claim gas", g - gasleft());
    }
}
