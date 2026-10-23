// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpindleClaims} from "../../src/SpindleClaims.sol";

contract ClaimsForkTest is Test {
    IERC20 constant USDG = IERC20(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168);
    address constant POOL = 0x69BfaF19C9f377BB306a89aEd9F6B07e2c1a8d9a;

    function test_fork_postWarpClaim() public {
        vm.createSelectFork(vm.envString("RHC_RPC_URL"), 95_811_000);
        address poster = makeAddr("poster");
        address guardian = makeAddr("guardian");
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        SpindleClaims claims = new SpindleClaims(USDG, poster, guardian, 5_000e6, 3600);

        uint256 funded = 1_000e6;
        deal(address(USDG), address(claims), funded);
        if (USDG.balanceOf(address(claims)) != funded) {
            vm.prank(POOL);
            USDG.transfer(address(claims), funded);
        }
        emit log_named_uint("deal worked (1=yes)", USDG.balanceOf(address(claims)) == funded ? 1 : 0);
        assertEq(USDG.balanceOf(address(claims)), funded);

        uint256 ca = 100e6;
        uint256 cb = 50e6;
        bytes32 la = keccak256(bytes.concat(keccak256(abi.encode(alice, ca))));
        bytes32 lb = keccak256(bytes.concat(keccak256(abi.encode(bob, cb))));
        bytes32 root = la < lb ? keccak256(abi.encodePacked(la, lb)) : keccak256(abi.encodePacked(lb, la));

        vm.prank(poster);
        uint256 g = gasleft();
        claims.postRoot(1, root, ca + cb);
        emit log_named_uint("fork postRoot gas", g - gasleft());

        vm.warp(block.timestamp + 3600);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = lb;
        vm.prank(alice);
        g = gasleft();
        claims.claim(1, ca, proof, ca);
        uint256 used = g - gasleft();
        emit log_named_uint("fork claim gas", used);
        assertLe(used, 150_000);
        assertEq(USDG.balanceOf(alice), ca);
        assertEq(USDG.balanceOf(address(claims)), funded - ca);
    }
}
