// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SpindleRegistry} from "../../src/SpindleRegistry.sol";
import {ISpindleRegistry} from "../../src/interfaces/ISpindleRegistry.sol";
import {SpindleStaking} from "../../src/SpindleStaking.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

interface IRealIdentity {
    function register() external returns (uint256 agentId);
    function ownerOf(uint256) external view returns (address);
}

/// @notice Fork test against the real ERC-8004 IdentityRegistry on RHC (chain 4663).
contract RegistryForkTest is Test {
    address constant IDENTITY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    uint256 constant FORK_BLOCK = 95_810_000;

    function setUp() public {
        vm.createSelectFork("rhc", FORK_BLOCK);
    }

    function test_fork_registerStakeAndLinkRealIdentity() public {
        assertEq(block.chainid, 4663);
        SpindleRegistry reg = new SpindleRegistry(IDENTITY);
        MockERC20 spdl = new MockERC20("Spindle", "SPDL", 18);
        SpindleStaking st = new SpindleStaking(spdl, reg, address(0x51), address(0x52), 5e17, 1e18, 2e18, 3e18, 4e18);

        address owner = makeAddr("owner");
        uint256 pk = uint256(keccak256("fork-node-key"));
        address key = vm.addr(pk);
        uint256 dl = block.timestamp + 1 hours;
        bytes32 dom = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("SpindleRegistry"),
                keccak256("1"),
                block.chainid,
                address(reg)
            )
        );
        bytes32 sh = keccak256(abi.encode(reg.NODE_BINDING_TYPEHASH(), owner, key, uint8(2), false, dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, keccak256(abi.encodePacked("\x19\x01", dom, sh)));
        vm.prank(owner);
        uint256 nid = reg.registerNode(key, 2, false, bytes32(0), dl, abi.encodePacked(r, s, v));

        // staking works on RHC (transient-storage reentrancy guard included)
        spdl.mint(owner, 10e18);
        vm.startPrank(owner);
        spdl.approve(address(st), 10e18);
        st.stake(nid, 10e18);
        vm.stopPrank();
        (uint256 active,,) = st.stakeOf(nid);
        assertEq(active, 10e18);

        // the real registry's register() is public and takes no args
        vm.prank(owner);
        uint256 agentId = IRealIdentity(IDENTITY).register();
        assertEq(IRealIdentity(IDENTITY).ownerOf(agentId), owner);

        vm.prank(owner);
        reg.linkIdentity(nid, agentId);
        assertEq(reg.getNode(nid).agentId, agentId);

        // an identity owned by someone else cannot be linked
        vm.prank(makeAddr("other"));
        uint256 otherAgent = IRealIdentity(IDENTITY).register();
        vm.prank(owner);
        vm.expectRevert(ISpindleRegistry.IdentityNotOwned.selector);
        reg.linkIdentity(nid, otherAgent);
    }
}
