// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";

/// @notice Exercises admin setters, views, and access control to keep coverage high and lock the
///         "admin only by owner" guarantees.
contract AdminViewsTest is Base {
    function setUp() public {
        _deploy();
    }

    function test_AdminSettersByOwner() public {
        registry.setClaimFee(0.01 ether);
        assertEq(registry.claimFee(), 0.01 ether);

        registry.setMaxClaimsPerAddress(10);
        assertEq(registry.maxClaimsPerAddress(), 10);

        registry.setProtocolFeeReceiver(address(0xCAFE));
        assertEq(registry.protocolFeeReceiver(), address(0xCAFE));

        registry.setWhitelistRoot(bytes32(uint256(1)));
        assertEq(registry.whitelistRoot(), bytes32(uint256(1)));

        registry.setWhitelistEnabled(false);
        assertFalse(registry.whitelistEnabled());

        market.setProtocolFeeReceiver(address(0xCAFE));
        assertEq(market.protocolFeeReceiver(), address(0xCAFE));
    }

    function test_AdminSettersRevertForNonOwner() public {
        vm.startPrank(eve);
        vm.expectRevert();
        registry.setClaimFee(1);
        vm.expectRevert();
        registry.setMaxClaimsPerAddress(1);
        vm.expectRevert();
        registry.setWhitelistEnabled(false);
        vm.expectRevert();
        registry.setWhitelistRoot(bytes32(0));
        vm.expectRevert();
        registry.setProtocolFeeReceiver(address(1));
        vm.expectRevert();
        market.setProtocolFeeReceiver(address(1));
        vm.stopPrank();
    }

    function test_ZeroReceiverReverts() public {
        vm.expectRevert(bytes("ZERO_RECEIVER"));
        registry.setProtocolFeeReceiver(address(0));
    }

    function test_ReservedBatch() public {
        string[] memory words = new string[](2);
        words[0] = "ethereum";
        words[1] = "bitcoin";
        registry.setReservedBatch(words, true);
        assertTrue(registry.isReserved(keccak256("ethereum")));
        assertTrue(registry.isReserved(keccak256("bitcoin")));
    }

    function test_Views() public {
        _enroll(alice);
        uint256 id = _claim(alice, "bread");

        assertEq(registry.tokenIdOf("BREAD"), id);
        assertEq(registry.tokenIdOf("br ead"), 0); // invalid -> 0
        assertEq(registry.tokenIdOf("unclaimed"), 0);

        assertTrue(registry.isClaimed("bread"));
        assertFalse(registry.isClaimed("nope"));
        assertFalse(registry.isClaimed("bad word"));

        (bool valid, bool available, string memory norm) = registry.checkAvailability(" BREAD ");
        assertTrue(valid);
        assertFalse(available); // claimed
        assertEq(norm, "bread");

        (valid, available,) = registry.checkAvailability("fresh");
        assertTrue(valid && available);

        (valid, available,) = registry.checkAvailability("no!");
        assertFalse(valid || available);

        // tokenURI returns the word only, no image.
        assertEq(registry.tokenURI(id), '{"name":"bread"}');

        // remaining claims accounting
        assertEq(registry.remainingClaims(alice), MAX_CLAIMS - 1);
        assertEq(registry.remainingClaims(bob), MAX_CLAIMS);
    }

    function test_RemainingClaimsUnlimited() public {
        registry.setMaxClaimsPerAddress(0);
        assertEq(registry.remainingClaims(alice), type(uint256).max);
    }

    function test_WithdrawNothingReverts() public {
        vm.expectRevert(bytes("NOTHING"));
        registry.withdrawFees();
        vm.prank(alice);
        vm.expectRevert(bytes("NOTHING"));
        market.withdraw();
        vm.expectRevert(bytes("NOTHING"));
        market.withdrawFees();
    }

    function test_EnrollIdempotent() public {
        _enroll(alice);
        _enroll(alice); // second enroll is a no-op, not a revert
        assertTrue(registry.isWhitelisted(alice));
    }

    function test_MarketViewsEmpty() public view {
        assertEq(market.totalEverListed(), 0);
        (uint256[] memory ids,,) = market.activeListingsPage(0, 10);
        assertEq(ids.length, 0);
    }
}
