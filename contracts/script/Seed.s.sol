// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WordRegistry} from "../src/WordRegistry.sol";
import {WordMarket} from "../src/WordMarket.sol";
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
        (uint256 keepListed,) = registry.claim{value: fee}("wordsmash");
        (uint256 forSale,) = registry.claim{value: fee}("base");
        // List both; "base" will be bought below, "wordsmash" stays on the marketplace.
        // Per-token approvals: the marketplace no longer accepts operator approvals.
        registry.approve(address(market), keepListed);
        registry.approve(address(market), forSale);
        market.list(keepListed, 0.1 ether);
        market.list(forSale, 0.05 ether);
        vm.stopBroadcast();

        // Account 1: enroll, buy the listed deed (a Sale), TRADE "genesis", and CLAIM two more
        // words + trade them — so the discovery boards (New / Trending / About-to-graduate) and the
        // live feed have several coins with real activity.
        WordMarket genesisMarket = WordMarket(payable(registry.marketOf("genesis")));
        vm.startBroadcast(PK1);
        registry.verifyWhitelist(proof1);
        market.buy{value: 0.05 ether}(forSale, 0.05 ether);
        genesisMarket.buy{value: 0.5 ether}(0);
        uint256 half = genesisMarket.balanceOf(ACC1) / 2;
        genesisMarket.sell(half, 0);

        (, address solMkt) = registry.claim{value: fee}("solana");
        (, address degenMkt) = registry.claim{value: fee}("degen");
        WordMarket(payable(solMkt)).buy{value: 2 ether}(0); // pushes ~20% toward graduation
        WordMarket(payable(degenMkt)).buy{value: 0.3 ether}(0);
        vm.stopBroadcast();

        // Account 0 also buys a bit of its own token (more activity + price movement).
        vm.startBroadcast(PK0);
        genesisMarket.buy{value: 0.2 ether}(0);
        WordMarket(payable(degenMkt)).buy{value: 0.1 ether}(0);
        vm.stopBroadcast();

        console2.log("Seeded: 5 words, token markets, trades, a deed sale.");
        console2.log("$GENESIS market:", address(genesisMarket));
        console2.log("$SOLANA market (graduating):", solMkt);
    }
}
