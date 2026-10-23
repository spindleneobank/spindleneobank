// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {RelayStubDepository} from "../../src/dev/RelayStubDepository.sol";

contract RelayStubTest is Test {
    event StubDeposit(bytes32 indexed requestId, address indexed sender, address token, uint256 amount);

    MockERC20 token;
    RelayStubDepository stub;
    address user = makeAddr("user");

    function setUp() public {
        token = new MockERC20("USDG", "USDG", 6);
        stub = new RelayStubDepository();
        token.mint(user, 100e6);
    }

    function test_depositEmitsEventAndMovesFunds() public {
        bytes32 id = keccak256("req");
        vm.startPrank(user);
        token.approve(address(stub), 40e6);
        vm.expectEmit(true, true, false, true, address(stub));
        emit StubDeposit(id, user, address(token), 40e6);
        stub.deposit(id, address(token), 40e6);
        vm.stopPrank();
        assertEq(token.balanceOf(address(stub)), 40e6);
        assertEq(token.balanceOf(user), 60e6);
    }

    function test_depositWithoutAllowanceReverts() public {
        vm.prank(user);
        vm.expectRevert();
        stub.deposit(bytes32(0), address(token), 1e6);
    }
}
