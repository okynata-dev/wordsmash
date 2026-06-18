// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WordRegistry} from "../src/WordRegistry.sol";
import {DeedMarketplace} from "../src/DeedMarketplace.sol";

/// @notice Seeds the LOCAL anvil deployment with demo data so the app/indexer have something to show:
///         enrolls two default anvil accounts, claims several words, lists one, and buys it (a sale).
///
///   forge script script/Seed.s.sol:Seed --rpc-url http://localhost:8545 --broadcast
///
/// Uses the well-known public anvil dev keys (TESTNET/LOCAL ONLY — never real funds).
contract Seed is Script {
    // Default anvil accounts #0 and #1 (public, deterministic — local dev only).
    uint256 constant PK0 = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    uint256 constant PK1 = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
    address constant ACC0 = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address constant ACC1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        string memory dep = vm.readFile("../shared/deployments/anvil.json");
        WordRegistry registry = WordRegistry(payable(vm.parseJsonAddress(dep, ".wordRegistry")));
        DeedMarketplace market = DeedMarketplace(payable(vm.parseJsonAddress(dep, ".deedMarketplace")));

        string memory pf = vm.readFile("../shared/whitelist/proofs.json");
        bytes32[] memory proof0 = vm.parseJsonBytes32Array(pf, ".proofs.0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266.proof");
        bytes32[] memory proof1 = vm.parseJsonBytes32Array(pf, ".proofs.0x70997970c51812dc3a010c7d01b50e0d17dc79c8.proof");

        uint256 fee = registry.claimFee();

        // Account 0: enroll + claim a few words, list one for sale.
        vm.startBroadcast(PK0);
        registry.verifyWhitelist(proof0);
        registry.claim{value: fee}("genesis");
        uint256 keepListed = registry.claim{value: fee}("wordsmash");
        uint256 forSale = registry.claim{value: fee}("base");
        // List both; "base" will be bought below, "wordsmash" stays on the marketplace.
        registry.setApprovalForAll(address(market), true);
        market.list(keepListed, 0.1 ether);
        market.list(forSale, 0.05 ether);
        vm.stopBroadcast();

        // Account 1: enroll + buy the listed deed (creates a Sale for the leaderboard).
        vm.startBroadcast(PK1);
        registry.verifyWhitelist(proof1);
        market.buy{value: 0.05 ether}(forSale);
        vm.stopBroadcast();

        console2.log("Seeded: 3 words claimed by", ACC0);
        console2.log("Sale: 'base' bought by", ACC1);
    }
}
