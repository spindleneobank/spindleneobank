// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SpindleRegistry} from "../../src/SpindleRegistry.sol";
import {ISpindleRegistry} from "../../src/interfaces/ISpindleRegistry.sol";
import {MockIdentity} from "../../src/mocks/MockIdentity.sol";

contract RegistryTest is Test {
    SpindleRegistry reg;
    MockIdentity id;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 nodePk = 0xA11CE;
    address nodeKey;

    function setUp() public {
        id = new MockIdentity();
        reg = new SpindleRegistry(address(id));
        nodeKey = vm.addr(nodePk);
    }

    function _sig(uint256 pk, address owner, address key, uint8 cls, bool cc, uint256 dl)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(abi.encode(reg.NODE_BINDING_TYPEHASH(), owner, key, cls, cc, dl));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domain(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _domain() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SpindleRegistry"),
                keccak256("1"),
                block.chainid,
                address(reg)
            )
        );
    }

    function _register(address owner) internal returns (uint256) {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, owner, nodeKey, 2, false, dl);
        vm.prank(owner);
        return reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
    }

    function test_register_happyPath() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 2, true, dl);
        vm.expectEmit(true, true, true, true);
        emit ISpindleRegistry.NodeRegistered(1, alice, nodeKey, 2, true, bytes32(uint256(7)));
        vm.prank(alice);
        uint256 nid = reg.registerNode(nodeKey, 2, true, bytes32(uint256(7)), dl, sig);
        assertEq(nid, 1);
        assertEq(reg.nodeIdOfKey(nodeKey), 1);
        assertEq(reg.ownerOf(1), alice);
        ISpindleRegistry.Node memory n = reg.getNode(1);
        assertEq(n.owner, alice);
        assertEq(n.nodeKey, nodeKey);
        assertEq(n.gpuClass, 2);
        assertTrue(n.ccCapable);
        assertTrue(n.active);
        assertEq(n.agentId, 0);
        assertEq(n.registeredAt, block.timestamp);
    }

    function test_register_revertsBadSig() public {
        uint256 dl = block.timestamp + 1 hours;
        // signed by wrong key
        bytes memory sig = _sig(0xBEEF, alice, nodeKey, 2, false, dl);
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
        // signed for a different owner (front-run by bob)
        sig = _sig(nodePk, alice, nodeKey, 2, false, dl);
        vm.prank(bob);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
        // wrong length
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, hex"1234");
    }

    function testFuzz_register_neverWithoutValidSig(uint256 otherPk, bytes calldata junk, address caller) public {
        otherPk = bound(otherPk, 1, type(uint160).max);
        vm.assume(vm.addr(otherPk) != nodeKey);
        vm.assume(caller != address(0));
        uint256 dl = block.timestamp + 1 hours;
        vm.startPrank(caller);
        vm.expectRevert();
        reg.registerNode(nodeKey, 1, false, bytes32(0), dl, junk);
        bytes memory wrong = _sig(otherPk, caller, nodeKey, 1, false, dl);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.registerNode(nodeKey, 1, false, bytes32(0), dl, wrong);
        vm.stopPrank();
        assertEq(reg.nodeIdOfKey(nodeKey), 0);
    }

    function test_register_revertsExpired() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 2, false, dl);
        vm.warp(dl + 1);
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.Expired.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
    }

    function test_register_revertsKeyInUse() public {
        _register(alice);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, bob, nodeKey, 2, false, dl);
        vm.prank(bob);
        vm.expectRevert(ISpindleRegistry.KeyInUse.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
    }

    function test_register_revertsInvalidClass() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 5, false, dl);
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.InvalidClass.selector);
        reg.registerNode(nodeKey, 5, false, bytes32(0), dl, sig);
    }

    function test_update_requiresFreshSig() public {
        uint256 nid = _register(alice);
        uint256 dl = block.timestamp + 1 hours;
        // sig for old values does not authorise new values
        bytes memory old = _sig(nodePk, alice, nodeKey, 2, false, dl);
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.updateNode(nid, 3, true, bytes32(uint256(1)), dl, old);

        bytes memory fresh = _sig(nodePk, alice, nodeKey, 3, true, dl);
        vm.prank(bob);
        vm.expectRevert(ISpindleRegistry.NotOwner.selector);
        reg.updateNode(nid, 3, true, bytes32(uint256(1)), dl, fresh);

        vm.expectEmit(true, false, false, true);
        emit ISpindleRegistry.NodeUpdated(nid, 3, true, bytes32(uint256(1)));
        vm.prank(alice);
        reg.updateNode(nid, 3, true, bytes32(uint256(1)), dl, fresh);
        ISpindleRegistry.Node memory n = reg.getNode(nid);
        assertEq(n.gpuClass, 3);
        assertTrue(n.ccCapable);
        assertEq(n.attestationRef, bytes32(uint256(1)));
    }

    function test_deactivate_freesKey() public {
        uint256 nid = _register(alice);
        vm.prank(bob);
        vm.expectRevert(ISpindleRegistry.NotOwner.selector);
        reg.deactivate(nid);

        vm.expectEmit(true, false, false, false);
        emit ISpindleRegistry.NodeDeactivated(nid);
        vm.prank(alice);
        reg.deactivate(nid);
        assertEq(reg.nodeIdOfKey(nodeKey), 0);
        assertFalse(reg.getNode(nid).active);
        assertEq(reg.ownerOf(nid), alice);

        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.NotActive.selector);
        reg.deactivate(nid);

        // key may be re-registered (by anyone with a fresh sig) and gets a new id
        uint256 nid2 = _register(bob);
        assertEq(nid2, 2);
        assertEq(reg.nodeIdOfKey(nodeKey), 2);
    }

    function test_linkIdentity_ownerCheck() public {
        uint256 nid = _register(alice);
        uint256 aliceAgent = id.mint(alice);
        uint256 bobAgent = id.mint(bob);

        vm.prank(bob);
        vm.expectRevert(ISpindleRegistry.NotOwner.selector);
        reg.linkIdentity(nid, bobAgent);

        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.IdentityNotOwned.selector);
        reg.linkIdentity(nid, bobAgent);

        vm.expectEmit(true, true, false, false);
        emit ISpindleRegistry.IdentityLinked(nid, aliceAgent);
        vm.prank(alice);
        reg.linkIdentity(nid, aliceAgent);
        assertEq(reg.getNode(nid).agentId, aliceAgent);
    }

    // Found by mutation testing: boundaries and refusals nothing exercised.
    function test_register_highestClassAllowed() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 4, false, dl);
        vm.prank(alice);
        uint256 nid = reg.registerNode(nodeKey, 4, false, bytes32(0), dl, sig);
        assertEq(reg.getNode(nid).gpuClass, 4);
    }

    function test_register_validUntilItsDeadline() public {
        uint256 dl = block.timestamp;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 2, false, dl);
        vm.prank(alice);
        assertEq(reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig), 1);
    }

    function test_register_revertsWrongSigLength() public {
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = abi.encodePacked(_sig(nodePk, alice, nodeKey, 2, false, dl), uint8(0));
        vm.prank(alice);
        vm.expectRevert(ISpindleRegistry.BadNodeSignature.selector);
        reg.registerNode(nodeKey, 2, false, bytes32(0), dl, sig);
    }

    function test_update_revertsInvalidClassAndAllowsHighest() public {
        uint256 nid = _register(alice);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory five = _sig(nodePk, alice, nodeKey, 5, false, dl);
        bytes memory four = _sig(nodePk, alice, nodeKey, 4, false, dl);
        vm.startPrank(alice);
        vm.expectRevert(ISpindleRegistry.InvalidClass.selector);
        reg.updateNode(nid, 5, false, bytes32(0), dl, five);
        reg.updateNode(nid, 4, false, bytes32(0), dl, four);
        vm.stopPrank();
        assertEq(reg.getNode(nid).gpuClass, 4);
    }

    function test_deactivated_cannotUpdateOrLink() public {
        uint256 nid = _register(alice);
        uint256 dl = block.timestamp + 1 hours;
        bytes memory sig = _sig(nodePk, alice, nodeKey, 3, false, dl);
        vm.startPrank(alice);
        reg.deactivate(nid);
        vm.expectRevert(ISpindleRegistry.NotActive.selector);
        reg.updateNode(nid, 3, false, bytes32(0), dl, sig);
        vm.expectRevert(ISpindleRegistry.NotActive.selector);
        reg.linkIdentity(nid, 1);
        vm.stopPrank();
    }
}
