// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {WordRegistry} from "../src/WordRegistry.sol";

/// @notice Reserve the brand/trademark/abuse word list from shared/reserved-words.txt
///         (one word per line). Idempotent — safe to re-run as the list grows. Owner-only.
///
///   REGISTRY=0x... forge script script/Reserve.s.sol:Reserve \
///     --rpc-url $RPC --broadcast
contract Reserve is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address registryAddr = vm.envAddress("REGISTRY");
        string memory raw = vm.readFile("../shared/reserved-words.txt");
        string[] memory words = vm.split(raw, "\n");

        // Count non-empty lines, then build the exact-size array setReservedBatch wants.
        uint256 n;
        for (uint256 i = 0; i < words.length; i++) {
            if (bytes(words[i]).length > 0) n++;
        }
        string[] memory list = new string[](n);
        uint256 j;
        for (uint256 i = 0; i < words.length; i++) {
            if (bytes(words[i]).length > 0) list[j++] = words[i];
        }

        vm.startBroadcast(pk);
        WordRegistry(registryAddr).setReservedBatch(list, true);
        vm.stopBroadcast();
        console2.log("Reserved words:", n);
    }
}
