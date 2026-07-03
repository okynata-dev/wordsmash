// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {WordRegistry} from "../src/WordRegistry.sol";
import {DeedMarketplace} from "../src/DeedMarketplace.sol";

/// @dev Drives random claim/list/buy/cancel/withdraw/transfer across 4 whitelisted actors.
contract Handler is Base {
    string[6] internal WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
    address[4] internal actors;

    uint256 public successfulClaims; // ghost: count of unique words minted
    uint256 public reservedWord_claims; // ghost: must stay 0

    constructor() {
        _deploy();
        actors = [alice, bob, carol, dave];
        for (uint256 i; i < 4; i++) {
            _enroll(actors[i]);
        }
        // Reserve one word for the "reserved never claimable" invariant.
        registry.setReserved("charlie", true);
    }

    function actorAt(uint256 i) external view returns (address) {
        return actors[i % 4];
    }

    function getRegistry() external view returns (WordRegistry) {
        return registry;
    }

    function getMarket() external view returns (DeedMarketplace) {
        return market;
    }

    function claim(uint256 a, uint256 w) public {
        address who = actors[a % 4];
        string memory word = WORDS[w % 6];
        bool wasClaimed = registry.isClaimed(word);
        vm.prank(who);
        try registry.claim{value: CLAIM_FEE}(word) {
            if (!wasClaimed) successfulClaims++;
            if (keccak256(bytes(word)) == keccak256("charlie")) reservedWord_claims++;
        } catch {}
    }

    function list(uint256 a, uint256 w, uint256 price) public {
        address who = actors[a % 4];
        uint256 id = registry.tokenIdOf(WORDS[w % 6]);
        if (id == 0) return;
        price = bound(price, 1, 100 ether);
        vm.startPrank(who);
        try registry.approve(address(market), id) {
            try market.list(id, price) {} catch {}
        } catch {}
        vm.stopPrank();
    }

    function buy(uint256 a, uint256 w, uint256 pay) public {
        address who = actors[a % 4];
        uint256 id = registry.tokenIdOf(WORDS[w % 6]);
        if (id == 0) return;
        pay = bound(pay, 0, 100 ether);
        (, uint256 price,) = market.listings(id);
        vm.prank(who);
        try market.buy{value: pay}(id, price) {} catch {}
    }

    function cancel(uint256 a, uint256 w) public {
        address who = actors[a % 4];
        uint256 id = registry.tokenIdOf(WORDS[w % 6]);
        if (id == 0) return;
        vm.prank(who);
        try market.cancel(id) {} catch {}
    }

    function withdraw(uint256 a) public {
        address who = actors[a % 4];
        vm.prank(who);
        try market.withdraw() {} catch {}
    }

    function transfer(uint256 a, uint256 b, uint256 w) public {
        address from = actors[a % 4];
        address to = actors[b % 4];
        uint256 id = registry.tokenIdOf(WORDS[w % 6]);
        if (id == 0) return;
        vm.prank(from);
        try registry.transferFrom(from, to, id) {} catch {}
    }
}

contract InvariantsTest is Base {
    Handler internal handler;
    WordRegistry internal reg;
    DeedMarketplace internal mkt;

    function setUp() public {
        handler = new Handler();
        reg = handler.getRegistry();
        mkt = handler.getMarket();
        targetContract(address(handler));
    }

    /// Uniqueness: total minted words exactly equals the count of successful unique claims —
    /// no path ever mints two deeds for one canonical word.
    function invariant_uniqueness() public view {
        assertEq(reg.totalWords(), handler.successfulClaims());
    }

    /// Reserved word is never claimable by anyone.
    function invariant_reservedNeverClaimed() public view {
        assertEq(handler.reservedWord_claims(), 0);
        assertFalse(reg.isClaimed("charlie"));
    }

    /// Claim limit can never be exceeded for any actor while the limit is active.
    function invariant_claimLimit() public view {
        for (uint256 i; i < 4; i++) {
            address actor = handler.actorAt(i);
            assertLe(reg.claimsBy(actor), MAX_CLAIMS);
        }
    }

    /// Whitelist gate: every deed owner is whitelisted (gate stays enabled throughout this run).
    function invariant_allHoldersWhitelisted() public view {
        uint256 n = reg.totalWords();
        for (uint256 i; i < n; i++) {
            uint256 id = reg.allTokenIds(i);
            assertTrue(reg.isWhitelisted(reg.ownerOf(id)));
        }
    }

    /// Marketplace solvency: contract balance always covers all pull liabilities — fee accounting
    /// never overdraws.
    function invariant_marketplaceSolvent() public view {
        uint256 liabilities = mkt.accruedFees();
        for (uint256 i; i < 4; i++) {
            liabilities += mkt.pendingWithdrawals(handler.actorAt(i));
        }
        assertGe(address(mkt).balance, liabilities);
    }
}
