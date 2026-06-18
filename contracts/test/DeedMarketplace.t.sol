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
        market.buy{value: 10 ether}(id);

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
        market.buy{value: 7 ether}(id);
        assertEq(market.pendingWithdrawals(bob), 2 ether); // refund credited
    }

    function test_BuyRequiresBuyerWhitelisted() public {
        _list(1 ether);
        vm.prank(eve);
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        market.buy{value: 1 ether}(id);
    }

    function test_CancelPreventsBuy() public {
        _list(1 ether);
        vm.prank(alice);
        market.cancel(id);
        vm.prank(bob);
        vm.expectRevert(bytes("NOT_LISTED"));
        market.buy{value: 1 ether}(id);
    }

    function test_InsufficientPaymentReverts() public {
        _list(5 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("INSUFFICIENT_PAYMENT"));
        market.buy{value: 4 ether}(id);
    }

    function test_FeeAccountingNeverOverdraws() public {
        _list(10 ether);
        vm.prank(bob);
        market.buy{value: 10 ether}(id);
        // Everyone withdraws; contract must end at zero, never reverting on insufficient balance.
        vm.prank(alice);
        market.withdraw();
        market.withdrawFees();
        assertEq(address(market).balance, 0);
    }

    function test_ActiveListingsPageDropsSold() public {
        _list(3 ether);
        (uint256[] memory ids,,) = market.activeListingsPage(0, 10);
        assertEq(ids.length, 1);
        vm.prank(bob);
        market.buy{value: 3 ether}(id);
        (ids,,) = market.activeListingsPage(0, 10);
        assertEq(ids.length, 0);
    }
}
