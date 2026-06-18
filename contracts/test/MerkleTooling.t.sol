// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WordRegistry} from "../src/WordRegistry.sol";

/// @notice Proves the off-chain Merkle tool (contracts/tools/merkle.mjs) emits a root + proofs that
///         the on-chain gate accepts. Reads the SAME shared/whitelist/proofs.json the frontend ships.
contract MerkleToolingTest is Test {
    // The default Anvil dev accounts that tools/whitelist.example.txt enrolls.
    address[5] internal ACCOUNTS = [
        0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
        0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
        0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
        0x90F79bf6EB2c4f870365E785982E1f101E93b906,
        0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
    ];

    function test_GeneratedProofsAreAcceptedOnChain() public {
        string memory json = vm.readFile("../shared/whitelist/proofs.json");
        bytes32 root = vm.parseJsonBytes32(json, ".root");

        WordRegistry registry = new WordRegistry(address(0xBEEF), 0, 0, root);

        for (uint256 i; i < ACCOUNTS.length; i++) {
            address acct = ACCOUNTS[i];
            string memory key = string.concat(".proofs.", Strings.toHexString(acct), ".proof");
            bytes32[] memory proof = vm.parseJsonBytes32Array(json, key);

            assertFalse(registry.isWhitelisted(acct));
            vm.prank(acct);
            registry.verifyWhitelist(proof);
            assertTrue(registry.isWhitelisted(acct), "tool proof accepted by contract");
        }
    }
}

/// @dev Minimal lowercase hex address formatter (vm has no direct helper for the JSON key).
library Strings {
    bytes16 private constant HEX = "0123456789abcdef";

    function toHexString(address a) internal pure returns (string memory) {
        uint160 value = uint160(a);
        bytes memory buf = new bytes(42);
        buf[0] = "0";
        buf[1] = "x";
        for (uint256 i = 0; i < 20; i++) {
            uint8 b = uint8(value >> (8 * (19 - i)));
            buf[2 + i * 2] = HEX[b >> 4];
            buf[3 + i * 2] = HEX[b & 0x0f];
        }
        return string(buf);
    }
}
