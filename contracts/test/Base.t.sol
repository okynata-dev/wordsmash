// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {WordRegistry} from "../src/WordRegistry.sol";
import {WordMarket} from "../src/WordMarket.sol";
import {DeedMarketplace} from "../src/DeedMarketplace.sol";

/// @dev Deploys the v1 stack and builds a 4-leaf Merkle whitelist (alice, bob, carol, dave) whose
///      proofs match OpenZeppelin's sorted-pair MerkleProof.verify. `eve` is intentionally not on
///      the list. Leaf = keccak256(abi.encodePacked(addr)), exactly as the registry computes it.
abstract contract Base is Test {
    WordRegistry internal registry;
    DeedMarketplace internal market;

    address internal protocol = address(0xBEEF);
    uint256 internal constant CLAIM_FEE = 0.0003 ether;
    uint256 internal constant MAX_CLAIMS = 3;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCA201);
    address internal dave = address(0xDA7E);
    address internal eve = address(0xE7E); // NOT whitelisted

    bytes32 internal root;
    mapping(address => bytes32[]) internal proofOf;
    WordMarket internal marketImpl;

    function _defaultCurveConfig() internal pure returns (WordMarket.Config memory) {
        return WordMarket.Config({
            tradeFeeBps: 100, // 1%
            protocolBps: 5000,
            deedBps: 4000,
            liquidityBps: 1000,
            tokenSupply: 1_000_000_000 ether,
            virtualEthReserve: 1 ether,
            graduationThreshold: 10 ether
        });
    }

    function _deploy() internal {
        _buildWhitelist();
        marketImpl = new WordMarket();
        registry =
            new WordRegistry(protocol, CLAIM_FEE, MAX_CLAIMS, root, address(marketImpl), _defaultCurveConfig());
        market = new DeedMarketplace(address(registry), protocol);

        for (uint256 i; i < 5; i++) {
            vm.deal([alice, bob, carol, dave, eve][i], 1000 ether);
        }
    }

    function _enroll(address who) internal {
        vm.prank(who);
        registry.verifyWhitelist(proofOf[who]);
    }

    function _claim(address who, string memory word) internal returns (uint256 tokenId) {
        vm.prank(who);
        (tokenId,) = registry.claim{value: CLAIM_FEE}(word);
    }

    // --- 4-leaf Merkle tree (sorted-pair, OZ-compatible) ---
    function _buildWhitelist() private {
        address[4] memory addrs = [alice, bob, carol, dave];
        bytes32[4] memory leaves;
        for (uint256 i; i < 4; i++) {
            leaves[i] = keccak256(abi.encodePacked(addrs[i]));
        }
        bytes32 h01 = _hashPair(leaves[0], leaves[1]);
        bytes32 h23 = _hashPair(leaves[2], leaves[3]);
        root = _hashPair(h01, h23);

        proofOf[alice] = _two(leaves[1], h23);
        proofOf[bob] = _two(leaves[0], h23);
        proofOf[carol] = _two(leaves[3], h01);
        proofOf[dave] = _two(leaves[2], h01);
        // eve: empty/invalid proof (left as zero-length)
    }

    function _two(bytes32 a, bytes32 b) private pure returns (bytes32[] memory arr) {
        arr = new bytes32[](2);
        arr[0] = a;
        arr[1] = b;
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a <= b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
