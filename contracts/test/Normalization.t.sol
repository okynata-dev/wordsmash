// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WordNormalizer} from "../src/libraries/WordNormalizer.sol";

/// @notice Proves the Solidity normalizer produces byte-identical canonical output to the TS
///         implementation by asserting both against the SAME shared fixture
///         (shared/fixtures/normalization-vectors.json, also consumed by shared/test/normalize.test.ts).
contract NormalizationTest is Test {
    using WordNormalizer for string;

    // Field order must match alphabetical JSON key order: input, normalized, valid.
    struct Vector {
        string input;
        string normalized;
        bool valid;
    }

    function test_FixtureParityWithTypeScript() public view {
        string memory json = vm.readFile("../shared/fixtures/normalization-vectors.json");
        bytes memory raw = vm.parseJson(json, ".vectors");
        Vector[] memory vectors = abi.decode(raw, (Vector[]));
        assertGt(vectors.length, 10, "fixture loaded");

        for (uint256 i = 0; i < vectors.length; i++) {
            (string memory got, bool ok) = vectors[i].input.normalize();
            assertEq(ok, vectors[i].valid, vectors[i].input);
            if (vectors[i].valid) {
                assertEq(got, vectors[i].normalized, vectors[i].input);
            }
        }
    }

    function test_DeterminismAndCollision() public pure {
        // Case + whitespace variants collapse to one canonical form.
        (string memory a,) = string("BREAD").normalize();
        (string memory b,) = string(" Bread ").normalize();
        (string memory c,) = string("bread").normalize();
        assertEq(keccak256(bytes(a)), keccak256(bytes(c)));
        assertEq(keccak256(bytes(b)), keccak256(bytes(c)));
        // Distinct words do not collide.
        (string memory d,) = string("brhead").normalize();
        assertTrue(keccak256(bytes(d)) != keccak256(bytes(c)));
    }

    function testFuzz_OutputAlwaysInCharset(string memory input) public pure {
        (string memory out, bool ok) = input.normalize();
        if (!ok) return;
        bytes memory b = bytes(out);
        assertGt(b.length, 0);
        assertLe(b.length, 30);
        for (uint256 i = 0; i < b.length; i++) {
            uint8 ch = uint8(b[i]);
            bool inSet = (ch >= 0x61 && ch <= 0x7a) || (ch >= 0x30 && ch <= 0x39);
            assertTrue(inSet, "only [a-z0-9] in output");
        }
    }

    function testFuzz_Idempotent(string memory input) public pure {
        (string memory out, bool ok) = input.normalize();
        if (!ok) return;
        // Normalizing an already-normalized word is a fixed point.
        (string memory out2, bool ok2) = out.normalize();
        assertTrue(ok2);
        assertEq(out, out2);
    }
}
