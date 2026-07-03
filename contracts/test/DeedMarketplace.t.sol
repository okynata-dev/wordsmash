// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";

contract DeedMarketplaceTest is Base {
    uint256 internal id;

    function setUp() public {
        _deploy();
        _enroll(alice);
        _enroll(bob);
        id = _claim(alice, "bread");
    }

    function _list(uint256 price) internal {
        vm.startPrank(alice);
        registry.approve(address(market), id);
        market.list(id, price);
        vm.stopPrank();
    }

    function test_ListRequiresOwnershipAndApproval() public {
        vm.prank(alice);
        vm.expectRevert(bytes("NOT_APPROVED"));
        market.list(id, 1 ether);

        vm.prank(bob);
        vm.expectRevert(bytes("NOT_OWNER"));
        market.list(id, 1 ether);
    }

    function test_ListRequiresWhitelist() public {
        registry.setWhitelistEnabled(false);
        // give eve the deed via a direct transfer (gate off), then re-enable gate
        vm.prank(alice);
        registry.transferFrom(alice, eve, id);
        registry.setWhitelistEnabled(true);
        vm.startPrank(eve);
        registry.approve(address(market), id);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        market.list(id, 1 ether);
        vm.stopPrank();
    }

    function test_BuyPaysSellerMinusFeeAndTransfersDeed() public {
        _list(10 ether);

        vm.prank(bob);
        market.buy{value: 10 ether}(id, 10 ether);

        // Deed moved; pull balances credited.
        assertEq(registry.ownerOf(id), bob);
        uint256 fee = (10 ether * 1000) / 10_000; // 10%
        assertEq(market.pendingWithdrawals(alice), 10 ether - fee);
        assertEq(market.accruedFees(), fee);

        // Seller pulls proceeds.
        uint256 before = alice.balance;
        vm.prank(alice);
        market.withdraw();
        assertEq(alice.balance - before, 10 ether - fee);

        // Protocol pulls fee.
        uint256 pBefore = protocol.balance;
        market.withdrawFees();
        assertEq(protocol.balance - pBefore, fee);
    }

    function test_BuyCreditsOverpaymentRefund() public {
        _list(5 ether);
        vm.prank(bob);
        market.buy{value: 7 ether}(id, 5 ether);
        assertEq(market.pendingWithdrawals(bob), 2 ether); // refund credited
    }

    function test_BuyRequiresBuyerWhitelisted() public {
        _list(1 ether);
        vm.prank(eve);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        market.buy{value: 1 ether}(id, 1 ether);
    }

    function test_CancelPreventsBuy() public {
        _list(1 ether);
        vm.prank(alice);
        market.cancel(id);
        vm.prank(bob);
        vm.expectRevert(bytes("NOT_LISTED"));
        market.buy{value: 1 ether}(id, 1 ether);
    }

    function test_InsufficientPaymentReverts() public {
        _list(5 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("INSUFFICIENT_PAYMENT"));
        market.buy{value: 4 ether}(id, 5 ether);
    }

    function test_FeeAccountingNeverOverdraws() public {
        _list(10 ether);
        vm.prank(bob);
        market.buy{value: 10 ether}(id, 10 ether);
        // Everyone withdraws; contract must end at zero, never reverting on insufficient balance.
        vm.prank(alice);
        market.withdraw();
        market.withdrawFees();
        assertEq(address(market).balance, 0);
    }

    // ── M-2 fix: a seller repricing mid-flight can't make the buyer pay the new price ──
    function test_RepriceInFlightRevertsBuy() public {
        _list(1 ether);
        vm.prank(alice);
        market.list(id, 3 ether); // seller front-runs with a higher price (approval persists)
        vm.prank(bob);
        vm.expectRevert(bytes("PRICE_CHANGED"));
        market.buy{value: 3 ether}(id, 1 ether); // buyer consented to 1 ETH, not 3
    }

    // ── M-1 fix: operator approvals are rejected; only per-token approve lists ────────
    function test_ApprovalForAllRejected() public {
        vm.startPrank(alice);
        registry.setApprovalForAll(address(market), true);
        vm.expectRevert(bytes("NOT_APPROVED"));
        market.list(id, 1 ether);
        // per-token approve works
        registry.approve(address(market), id);
        market.list(id, 1 ether);
        vm.stopPrank();
    }

    // ── M-1 fix: a listing dies with the transfer (approval cleared) and can be reaped ─
    function test_StaleListingUnexecutableAndReapable() public {
        _list(1 ether);
        vm.prank(alice);
        registry.transferFrom(alice, bob, id); // deed leaves; per-token approval cleared
        // direct buy fails (owner mismatch)
        vm.prank(bob);
        vm.expectRevert(bytes("SELLER_MOVED_DEED"));
        market.buy{value: 1 ether}(id, 1 ether);
        // even if the deed RETURNS to alice, the old listing can't execute: approval is gone
        vm.prank(bob);
        registry.transferFrom(bob, alice, id);
        vm.prank(bob);
        vm.expectRevert(); // ERC721InsufficientApproval inside safeTransferFrom
        market.buy{value: 1 ether}(id, 1 ether);
        // anyone can reap a listing whose deed moved away
        vm.prank(alice);
        registry.transferFrom(alice, bob, id);
        market.reap(id);
        (,, bool active) = market.listings(id);
        assertFalse(active);
    }

    // ── M-5: pause freezes list/buy; withdrawals stay live ───────────────────────────
    function test_PauseFreezesListAndBuyNotWithdraw() public {
        _list(2 ether);
        vm.prank(bob);
        market.buy{value: 2 ether}(id, 2 ether);
        registry.setPaused(true);
        vm.startPrank(bob);
        registry.approve(address(market), id);
        vm.expectRevert(bytes("PAUSED"));
        market.list(id, 5 ether);
        vm.stopPrank();
        // seller can still pull proceeds while paused
        vm.prank(alice);
        market.withdraw();
        registry.setPaused(false);
    }

    function test_ActiveListingsPageDropsSold() public {
        _list(3 ether);
        (uint256[] memory ids,,) = market.activeListingsPage(0, 10);
        assertEq(ids.length, 1);
        vm.prank(bob);
        market.buy{value: 3 ether}(id, 3 ether);
        (ids,,) = market.activeListingsPage(0, 10);
        assertEq(ids.length, 0);
    }
}
