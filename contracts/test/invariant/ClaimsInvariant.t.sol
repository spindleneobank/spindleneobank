// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";
import {SpindleClaims} from "../../src/SpindleClaims.sol";

contract ClaimsHandler is Test {
    MockERC20 public usdg;
    SpindleClaims public claims;
    address public poster;
    address public guardian;
    uint64 public constant DELAY = 3600;
    uint256 public constant CAP = 1_000e6;

    address[2] public owners;
    mapping(uint64 => uint256[2]) public cums; // per posted epoch
    uint64[] public epochs;
    uint64 public nextEpoch = 1;

    uint256 public ghostClaimedSum;
    uint256[2] public maxProven;
    bool public solvencyBroken;

    constructor(MockERC20 u, SpindleClaims c, address p, address g) {
        usdg = u;
        claims = c;
        poster = p;
        guardian = g;
        owners[0] = makeAddr("o0");
        owners[1] = makeAddr("o1");
    }

    function _leaf(address o, uint256 c) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(o, c))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    function post(uint256 inc0, uint256 inc1, uint256 fund, uint64 gap) external {
        inc0 = bound(inc0, 0, CAP / 2);
        inc1 = bound(inc1, 0, CAP / 2);
        fund = bound(fund, 0, 2 * CAP);
        gap = uint64(bound(gap, 1, 3));
        uint64 last = claims.lastEpoch();
        uint256 c0 = last == 0 ? 0 : cums[last][0];
        uint256 c1 = last == 0 ? 0 : cums[last][1];
        c0 += inc0;
        c1 += inc1;
        uint64 epoch = nextEpoch + gap;
        // Sometimes under-fund so Insolvent path is exercised.
        usdg.mint(address(claims), fund);
        bytes32 root = _pair(_leaf(owners[0], c0), _leaf(owners[1], c1));
        uint256 total = c0 + c1;
        bool shouldRevert = usdg.balanceOf(address(claims)) + claims.totalClaimed() < total;
        vm.prank(poster);
        try claims.postRoot(epoch, root, total) {
            if (shouldRevert) solvencyBroken = true;
            if (usdg.balanceOf(address(claims)) < total - claims.totalClaimed()) solvencyBroken = true;
            cums[epoch] = [c0, c1];
            epochs.push(epoch);
            nextEpoch = epoch;
        } catch {
            if (!shouldRevert) solvencyBroken = true;
        }
    }

    function claim(uint256 epochSeed, uint256 who, uint256 amount) external {
        if (epochs.length == 0) return;
        uint64 epoch = epochs[epochSeed % epochs.length];
        uint256 i = who % 2;
        uint256 cum = cums[epoch][i];
        uint256 other = cums[epoch][1 - i];
        amount = bound(amount, 0, cum + 1);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = _leaf(owners[1 - i], other);
        uint256 before = usdg.balanceOf(owners[i]);
        vm.prank(owners[i]);
        try claims.claim(epoch, cum, proof, amount) {
            // Invariant 9: a successful claim implies a non-vetoed root past its delay.
            (,, uint64 at, bool vetoed) = claims.roots(epoch);
            assertFalse(vetoed);
            assertGe(block.timestamp, uint256(at) + DELAY);
            ghostClaimedSum += amount;
            if (cum > maxProven[i]) maxProven[i] = cum;
            assertEq(usdg.balanceOf(owners[i]) - before, amount);
        } catch {}
    }

    function veto(uint256 epochSeed) external {
        if (epochs.length == 0) return;
        vm.prank(guardian);
        try claims.vetoRoot(epochs[epochSeed % epochs.length]) {} catch {}
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 2 * DELAY));
    }

    /// @dev Unauthorized and bad calls must always fail.
    function badClaim(uint256 amount) external {
        bytes32[] memory proof = new bytes32[](0);
        vm.prank(makeAddr("stranger"));
        try claims.claim(nextEpoch, amount, proof, amount) {
            ghostClaimedSum += amount; // would break the sum invariant
        } catch {}
    }
}

contract ClaimsInvariantTest is StdInvariant, Test {
    MockERC20 usdg;
    SpindleClaims claims;
    ClaimsHandler handler;

    function setUp() public {
        vm.warp(1_000_000);
        usdg = new MockERC20("USDG", "USDG", 6);
        address poster = makeAddr("poster");
        address guardian = makeAddr("guardian");
        claims = new SpindleClaims(usdg, poster, guardian, 1_000e6, 3600);
        handler = new ClaimsHandler(usdg, claims, poster, guardian);
        targetContract(address(handler));
    }

    // Invariant 6
    function invariant_totalClaimedBoundedByLastRoot() public view {
        (, uint256 total,,) = claims.roots(claims.lastEpoch());
        assertLe(claims.totalClaimed(), total);
    }

    // Sum of per-owner claimed == totalClaimed == ghost
    function invariant_sumClaimed() public view {
        uint256 s = claims.claimed(handler.owners(0)) + claims.claimed(handler.owners(1));
        assertEq(s, claims.totalClaimed());
        assertEq(s, handler.ghostClaimedSum());
    }

    // Invariants 7 and 10: claimed never exceeds largest cumulative proven
    function invariant_claimedBoundedByProven() public view {
        assertLe(claims.claimed(handler.owners(0)), handler.maxProven(0));
        assertLe(claims.claimed(handler.owners(1)), handler.maxProven(1));
    }

    // Invariant 8: solvency after every successful post, and post only reverts when it should
    function invariant_solvencyAtPost() public view {
        assertFalse(handler.solvencyBroken());
    }
}
