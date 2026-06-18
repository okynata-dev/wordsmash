// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WordRegistry} from "../src/WordRegistry.sol";
import {DeedMarketplace} from "../src/DeedMarketplace.sol";

/// @notice Deploys the v1 stack (registry/deed + marketplace) and writes the addresses to
///         shared/deployments/<network>.json for the indexer and web app to consume.
///
/// The whitelist root is read from shared/whitelist/proofs.json (generate it first with
/// `contracts/tools/merkle.mjs` from your address list — a HUMAN TASK for the real beta).
///
/// Local:        forge script script/Deploy.s.sol:Deploy --rpc-url http://localhost:8545 --broadcast
/// Base Sepolia: forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast -vvvv
///
/// Env (see /.env.example):
///   DEPLOYER_PRIVATE_KEY      testnet key only
///   PROTOCOL_FEE_RECEIVER     optional; defaults to deployer  (HUMAN TASK: real receiver)
///   CLAIM_FEE_WEI             optional; default 0.0003 ETH
///   MAX_CLAIMS_PER_ADDRESS    optional; default 3
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address protocol = vm.envOr("PROTOCOL_FEE_RECEIVER", deployer);
        uint256 claimFee = vm.envOr("CLAIM_FEE_WEI", uint256(0.0003 ether));
        uint256 maxClaims = vm.envOr("MAX_CLAIMS_PER_ADDRESS", uint256(3));

        bytes32 root = vm.parseJsonBytes32(vm.readFile("../shared/whitelist/proofs.json"), ".root");

        vm.startBroadcast(pk);
        WordRegistry registry = new WordRegistry(protocol, claimFee, maxClaims, root);
        DeedMarketplace marketplace = new DeedMarketplace(address(registry), protocol);

        // TODO(operator): the real reserved list (brands, trademarks, names, slurs) is a human task.
        // This seeds one example so the reserved path is demonstrable; load the rest from your list.
        registry.setReserved("bitcoin", true);
        vm.stopBroadcast();

        _writeDeployment(address(registry), address(marketplace));

        console2.log("WordRegistry:   ", address(registry));
        console2.log("DeedMarketplace:", address(marketplace));
        console2.log("Protocol:       ", protocol);
        console2.log("Whitelist root: ", vm.toString(root));
    }

    function _writeDeployment(address registry, address marketplace) internal {
        string memory network = block.chainid == 84532 ? "baseSepolia" : block.chainid == 31337 ? "anvil" : "unknown";
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeString(obj, "network", network);
        vm.serializeAddress(obj, "wordRegistry", registry);
        vm.serializeAddress(obj, "deedMarketplace", marketplace);
        string memory json = vm.serializeUint(obj, "startBlock", block.number);
        string memory path = string.concat("../shared/deployments/", network, ".json");
        vm.writeJson(json, path);
        console2.log("Wrote", path);
    }
}
