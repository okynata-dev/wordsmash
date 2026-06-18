// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";

contract WordRegistryTest is Base {
    function setUp() public {
        _deploy();
    }

    // --- whitelist enrollment ---

    function test_EnrollWithValidProof() public {
        assertFalse(registry.isWhitelisted(alice));
        _enroll(alice);
        assertTrue(registry.isWhitelisted(alice));
        assertTrue(registry.isAllowed(alice));
    }

    function test_EnrollWithBadProofReverts() public {
        vm.prank(eve);
        vm.expectRevert(bytes("BAD_PROOF"));
        registry.verifyWhitelist(proofOf[eve]); // empty proof
    }

    function test_ClaimRequiresWhitelistWhenEnabled() public {
        vm.prank(alice); // not enrolled yet
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        registry.claim{value: CLAIM_FEE}("bread");
    }

    function test_DisablingWhitelistOpensClaim() public {
        registry.setWhitelistEnabled(false);
        // eve is not on the list but can now claim.
        vm.prank(eve);
        registry.claim{value: CLAIM_FEE}("bread");
        assertEq(registry.ownerOf(uint256(keccak256("bread"))), eve);
    }

    // --- claim / uniqueness / normalization ---

    function test_ClaimMintsDeed() public {
        _enroll(alice);
        uint256 tokenId = _claim(alice, "bread");
        assertEq(tokenId, uint256(keccak256("bread")));
        assertEq(registry.ownerOf(tokenId), alice);
        assertEq(registry.wordOf(tokenId), "bread");
        assertEq(registry.totalWords(), 1);
    }

    function test_DuplicateVariantsRevert() public {
        _enroll(alice);
        _enroll(bob);
        _claim(alice, "bread");
        vm.prank(bob);
        vm.expectRevert(bytes("ALREADY_CLAIMED"));
        registry.claim{value: CLAIM_FEE}("BREAD");
        vm.prank(bob);
        vm.expectRevert(bytes("ALREADY_CLAIMED"));
        registry.claim{value: CLAIM_FEE}("  bread ");
    }

    function test_DistinctWordsSucceed() public {
        _enroll(alice);
        _claim(alice, "bread");
        _claim(alice, "brhead");
        assertEq(registry.totalWords(), 2);
    }

    function test_InvalidWordReverts() public {
        _enroll(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("INVALID_WORD"));
        registry.claim{value: CLAIM_FEE}("br ead");
        vm.prank(alice);
        vm.expectRevert(bytes("INVALID_WORD"));
        registry.claim{value: CLAIM_FEE}(unicode"brёad");
    }

    function test_InsufficientFeeReverts() public {
        _enroll(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("INSUFFICIENT_FEE"));
        registry.claim{value: CLAIM_FEE - 1}("bread");
    }

    function test_ClaimRefundsExcess() public {
        _enroll(alice);
        uint256 before = alice.balance;
        vm.prank(alice);
        registry.claim{value: 1 ether}("bread");
        assertEq(before - alice.balance, CLAIM_FEE);
    }

    // --- reserved ---

    function test_ReservedCannotBeClaimedByAnyone() public {
        registry.setReserved("bitcoin", true);
        _enroll(alice);
        vm.prank(alice);
        vm.expectRevert(bytes("RESERVED"));
        registry.claim{value: CLAIM_FEE}("Bitcoin");
        // not even the owner can claim a reserved word
        registry.setWhitelistEnabled(false);
        vm.expectRevert(bytes("RESERVED"));
        registry.claim{value: CLAIM_FEE}("bitcoin");
    }

    function test_OnlyOwnerCanReserve() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setReserved("bitcoin", true);
    }

    // --- claim limit (anti-bot) ---

    function test_ClaimLimitEnforced() public {
        _enroll(alice);
        _claim(alice, "one");
        _claim(alice, "two");
        _claim(alice, "three");
        assertEq(registry.remainingClaims(alice), 0);
        vm.prank(alice);
        vm.expectRevert(bytes("CLAIM_LIMIT"));
        registry.claim{value: CLAIM_FEE}("four");
    }

    function test_ClaimLimitNotBypassedByTransfer() public {
        _enroll(alice);
        _enroll(bob);
        _claim(alice, "one");
        _claim(alice, "two");
        uint256 id = _claim(alice, "three");
        // Transfer one away — the monotonic counter does NOT decrease.
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        vm.prank(alice);
        vm.expectRevert(bytes("CLAIM_LIMIT"));
        registry.claim{value: CLAIM_FEE}("four");
    }

    function test_OwnerCanLiftLimit() public {
        _enroll(alice);
        _claim(alice, "one");
        _claim(alice, "two");
        _claim(alice, "three");
        registry.setMaxClaimsPerAddress(0); // unlimited
        _claim(alice, "four");
        assertEq(registry.totalWords(), 4);
    }

    // --- transfer gate ---

    function test_TransferToNonWhitelistedReverts() public {
        _enroll(alice);
        uint256 id = _claim(alice, "bread");
        vm.prank(alice);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        registry.transferFrom(alice, eve, id); // eve not whitelisted
    }

    function test_OwnerCanGrantWhitelistDirectly() public {
        // eve has no proof, but the owner can grant her directly (rescue path).
        assertFalse(registry.isWhitelisted(eve));
        registry.setWhitelisted(eve, true);
        assertTrue(registry.isWhitelisted(eve));
        vm.prank(eve);
        registry.claim{value: CLAIM_FEE}("bread");
        assertEq(registry.ownerOf(uint256(keccak256("bread"))), eve);
    }

    function test_OwnerCanRevokeWhitelist() public {
        _enroll(alice);
        registry.setWhitelisted(alice, false); // revoke (root rotation alone can't do this)
        assertFalse(registry.isWhitelisted(alice));
        vm.prank(alice);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        registry.claim{value: CLAIM_FEE}("bread");
    }

    function test_StrandedDeedRescue() public {
        // Open phase: eve claims while the gate is off (her cached bool is never set).
        registry.setWhitelistEnabled(false);
        vm.prank(eve);
        uint256 id = registry.claim{value: CLAIM_FEE}("bread");
        // Gate re-enabled for public-launch rollback: eve can't transfer (stranded)...
        registry.setWhitelistEnabled(true);
        _enroll(bob);
        vm.prank(eve);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        registry.transferFrom(eve, bob, id);
        // ...until the owner grants her.
        registry.setWhitelisted(eve, true);
        vm.prank(eve);
        registry.transferFrom(eve, bob, id);
        assertEq(registry.ownerOf(id), bob);
    }

    function test_OnlyOwnerCanSetWhitelisted() public {
        vm.prank(eve);
        vm.expectRevert();
        registry.setWhitelisted(eve, true);
    }

    function test_SetWhitelistedBatch() public {
        address[] memory accts = new address[](2);
        accts[0] = eve;
        accts[1] = carol;
        registry.setWhitelistedBatch(accts, true);
        assertTrue(registry.isWhitelisted(eve) && registry.isWhitelisted(carol));
    }

    function test_TransferBetweenWhitelistedWorks() public {
        _enroll(alice);
        _enroll(bob);
        uint256 id = _claim(alice, "bread");
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        assertEq(registry.ownerOf(id), bob);
    }

    // --- fees (pull) ---

    function test_FeesAccrueAndWithdraw() public {
        _enroll(alice);
        _claim(alice, "one");
        _claim(alice, "two");
        assertEq(registry.accruedFees(), 2 * CLAIM_FEE);
        uint256 before = protocol.balance;
        registry.withdrawFees(); // owner
        assertEq(protocol.balance - before, 2 * CLAIM_FEE);
        assertEq(registry.accruedFees(), 0);
    }

    function test_OnlyAuthorizedWithdraw() public {
        _enroll(alice);
        _claim(alice, "one");
        vm.prank(eve);
        vm.expectRevert(bytes("NOT_AUTHORIZED"));
        registry.withdrawFees();
    }
}
