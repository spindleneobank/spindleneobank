// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISignatureTransfer} from "permit2/src/interfaces/ISignatureTransfer.sol";
import {SpindleRegistry} from "../src/SpindleRegistry.sol";
import {SpindleStaking} from "../src/SpindleStaking.sol";
import {SpindleClaims} from "../src/SpindleClaims.sol";
import {BuyerVault} from "../src/BuyerVault.sol";
import {ISpindleRegistry} from "../src/interfaces/ISpindleRegistry.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {RelayStubDepository} from "../src/dev/RelayStubDepository.sol";

/// @notice Deploys Registry -> Staking -> Claims -> Vault. Env: USDG, PERMIT2, SPDL, ERC8004_IDENTITY,
/// TREASURY, KEEPER, GUARDIAN, SLASHER, SLASH_RECIPIENT, MIN_STAKE_0..4, MAX_EPOCH_INCREASE, CLAIM_DELAY,
/// optional DEPLOY_DEV_STUBS (MockERC20 SPDL if unset + RelayStubDepository), FORK, ALLOW_MAINNET, COMMIT.
/// NO_STAKING=1 skips SpindleStaking (no SPDL yet): SPDL, SLASHER and MIN_STAKE_* are then ignored and the
/// deployment file records staking and spdl as the zero address. Staking can be deployed on its own later, since
/// Registry, Claims and Vault never reference it.
contract Deploy is Script {
    struct Params {
        address usdg;
        address permit2;
        address spdl;
        address identity;
        address treasury;
        address keeper;
        address guardian;
        address slasher;
        address slashRecipient;
        uint256 maxEpochIncrease;
        uint64 claimDelay;
    }

    address private stub;
    address private registry;
    address private staking;
    address private claims;
    address private vault;

    function run() external {
        bool stubs = vm.envOr("DEPLOY_DEV_STUBS", false);
        bool isFork = vm.envOr("FORK", uint256(0)) == 1;
        bool noStaking = vm.envOr("NO_STAKING", uint256(0)) == 1;
        if (stubs && block.chainid == 4663 && !isFork && !_eq(vm.envOr("ALLOW_MAINNET", string("")), "1")) {
            revert("Deploy: dev stubs refused on chain 4663 (set FORK=1 for the anvil fork)");
        }

        Params memory p;
        p.usdg = vm.envAddress("USDG");
        p.permit2 = vm.envAddress("PERMIT2");
        p.spdl = noStaking ? address(0) : vm.envOr("SPDL", address(0));
        p.identity = vm.envAddress("ERC8004_IDENTITY");
        p.treasury = vm.envAddress("TREASURY");
        p.keeper = vm.envAddress("KEEPER");
        p.guardian = vm.envAddress("GUARDIAN");
        p.slasher = noStaking ? address(0) : vm.envAddress("SLASHER");
        p.slashRecipient = noStaking ? address(0) : vm.envOr("SLASH_RECIPIENT", p.treasury);
        p.maxEpochIncrease = vm.envOr("MAX_EPOCH_INCREASE", uint256(5_000e6));
        p.claimDelay = uint64(vm.envOr("CLAIM_DELAY", uint256(3600)));
        uint256[5] memory mins = [
            vm.envOr("MIN_STAKE_0", uint256(100e18)),
            vm.envOr("MIN_STAKE_1", uint256(1_000e18)),
            vm.envOr("MIN_STAKE_2", uint256(5_000e18)),
            vm.envOr("MIN_STAKE_3", uint256(25_000e18)),
            vm.envOr("MIN_STAKE_4", uint256(50_000e18))
        ];

        if (noStaking) mins = [uint256(0), 0, 0, 0, 0];
        uint256 deployBlock = block.number;
        vm.startBroadcast();
        if (stubs) {
            if (p.spdl == address(0) && !noStaking) p.spdl = address(new MockERC20("Spindle", "SPDL", 18));
            stub = address(new RelayStubDepository());
        }
        require(noStaking || p.spdl != address(0), "Deploy: SPDL unset (set NO_STAKING=1 to deploy without staking)");
        registry = address(new SpindleRegistry(p.identity));
        if (!noStaking) {
            staking = address(
                new SpindleStaking(
                    IERC20(p.spdl),
                    ISpindleRegistry(registry),
                    p.slasher,
                    p.slashRecipient,
                    mins[0],
                    mins[1],
                    mins[2],
                    mins[3],
                    mins[4]
                )
            );
        }
        claims = address(new SpindleClaims(IERC20(p.usdg), p.keeper, p.guardian, p.maxEpochIncrease, p.claimDelay));
        vault = address(new BuyerVault(IERC20(p.usdg), ISignatureTransfer(p.permit2), claims, p.treasury, p.keeper));
        vm.stopBroadcast();

        _write(p, mins, deployBlock, isFork);
    }

    function _write(Params memory p, uint256[5] memory mins, uint256 deployBlock, bool isFork) private {
        string memory a = "addresses";
        vm.serializeAddress(a, "usdg", p.usdg);
        vm.serializeAddress(a, "permit2", p.permit2);
        vm.serializeAddress(a, "spdl", p.spdl);
        vm.serializeAddress(a, "erc8004Identity", p.identity);
        vm.serializeAddress(a, "relayStub", stub);
        vm.serializeAddress(a, "registry", registry);
        vm.serializeAddress(a, "staking", staking);
        vm.serializeAddress(a, "claims", claims);
        string memory addrJson = vm.serializeAddress(a, "vault", vault);

        string memory g = "args";
        vm.serializeAddress(g, "treasury", p.treasury);
        vm.serializeAddress(g, "keeper", p.keeper);
        vm.serializeAddress(g, "guardian", p.guardian);
        vm.serializeAddress(g, "slasher", p.slasher);
        vm.serializeAddress(g, "slashRecipient", p.slashRecipient);
        vm.serializeUint(g, "maxEpochIncrease", p.maxEpochIncrease);
        vm.serializeUint(g, "claimDelay", p.claimDelay);
        vm.serializeUint(g, "minStake0", mins[0]);
        vm.serializeUint(g, "minStake1", mins[1]);
        vm.serializeUint(g, "minStake2", mins[2]);
        vm.serializeUint(g, "minStake3", mins[3]);
        string memory argsJson = vm.serializeUint(g, "minStake4", mins[4]);

        string memory root = "deployment";
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeUint(root, "deployBlock", deployBlock);
        vm.serializeString(root, "commit", vm.envOr("COMMIT", string("")));
        vm.serializeString(root, "addresses", addrJson);
        string memory out = vm.serializeString(root, "args", argsJson);
        string memory file = string.concat("deployments/", vm.toString(block.chainid), isFork ? "-fork" : "", ".json");
        vm.writeJson(out, file);
    }

    function _eq(string memory x, string memory y) private pure returns (bool) {
        return keccak256(bytes(x)) == keccak256(bytes(y));
    }
}
