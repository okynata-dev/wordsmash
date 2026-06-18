// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {WordMarket} from "../src/WordMarket.sol";

contract WordMarketTest is Base {
    WordMarket internal m;
    uint256 internal deedId;

    function setUp() public {
        _deploy();
        _enroll(alice);
        _enroll(bob);
        _enroll(carol);
        _enroll(dave);
        deedId = _claim(alice, "bread"); // alice holds the deed
        m = WordMarket(payable(registry.marketOf("bread")));
    }

    // ── curve math ──────────────────────────────────────────────────────────────
    function test_BuyRaisesPriceSellLowers() public {
        uint256 p0 = m.currentPrice();
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        uint256 p1 = m.currentPrice();
        assertGt(p1, p0);
        uint256 bal = m.balanceOf(bob);
        vm.prank(bob);
        m.sell(bal, 0);
        assertLt(m.currentPrice(), p1);
    }

    function test_EarlyBuyerCheaper() public {
        vm.prank(bob);
        uint256 first = m.buy{value: 1 ether}(0);
        vm.prank(carol);
        uint256 second = m.buy{value: 1 ether}(0);
        assertGt(first, second);
    }

    function test_RoundTripCannotProfit() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        uint256 bal = m.balanceOf(bob);
        uint256 before = bob.balance;
        vm.prank(bob);
        m.sell(bal, 0);
        uint256 got = bob.balance - before;
        assertLt(got, 1 ether); // fees + curvature -> never profits
        assertGt(got, 0.95 ether);
    }

    function test_QuoteMatchesBuy() public {
        uint256 q = m.quoteBuy(1 ether);
        vm.prank(bob);
        uint256 actual = m.buy{value: 1 ether}(0);
        assertEq(q, actual);
    }

    function test_SlippageGuards() public {
        uint256 q = m.quoteBuy(1 ether);
        vm.prank(bob);
        vm.expectRevert(bytes("SLIPPAGE"));
        m.buy{value: 1 ether}(q + 1);
    }

    // ── whitelist gating on trading ──────────────────────────────────────────────
    function test_TradingRequiresWhitelist() public {
        vm.prank(eve); // not whitelisted
        vm.expectRevert(bytes("NOT_WHITELISTED"));
        m.buy{value: 1 ether}(0);
    }

    function test_DisablingWhitelistOpensTrading() public {
        registry.setWhitelistEnabled(false);
        vm.prank(eve);
        m.buy{value: 1 ether}(0);
        assertGt(m.balanceOf(eve), 0);
    }

    // ── fees ─────────────────────────────────────────────────────────────────────
    function test_FeeSplit_50_40_10() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        uint256 fee = (1 ether * 100) / 10_000;
        assertApproxEqAbs(m.protocolFeesAccrued(), (fee * 5000) / 10_000, 1);
        assertApproxEqAbs(m.deedFeesAccrued(), (fee * 4000) / 10_000, 1);
        assertApproxEqAbs(m.liquidityFeesAccrued(), (fee * 1000) / 10_000, 2);
    }

    function test_DeedOwnerClaimsFees() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        uint256 accrued = m.deedFeesAccrued();
        uint256 before = alice.balance;
        vm.prank(alice);
        m.claimFees();
        assertEq(alice.balance - before, accrued);
        assertEq(m.deedFeesAccrued(), 0);
    }

    function test_NonDeedOwnerCannotClaim() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        vm.prank(bob);
        vm.expectRevert(bytes("NOT_DEED_OWNER"));
        m.claimFees();
    }

    function test_ProtocolClaims() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        uint256 accrued = m.protocolFeesAccrued();
        uint256 before = protocol.balance;
        vm.prank(protocol);
        m.claimProtocolFees();
        assertEq(protocol.balance - before, accrued);
    }

    // ── the cash-flow thesis: deed transfer redirects future fees ──────────────────
    function test_DeedTransferRedirectsFutureFees() public {
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        vm.prank(alice);
        m.claimFees(); // alice takes her share

        vm.prank(alice);
        registry.transferFrom(alice, carol, deedId); // sell/transfer the deed to carol
        assertEq(m.deedOwner(), carol);

        vm.prank(bob);
        m.buy{value: 1 ether}(0); // new fees
        uint256 newFees = m.deedFeesAccrued();
        assertGt(newFees, 0);

        vm.prank(alice);
        vm.expectRevert(bytes("NOT_DEED_OWNER"));
        m.claimFees();

        uint256 before = carol.balance;
        vm.prank(carol);
        m.claimFees();
        assertEq(carol.balance - before, newFees);
    }

    // ── graduation ────────────────────────────────────────────────────────────────
    function test_GraduationFreezesBuysButSellsStayOpen() public {
        vm.prank(bob);
        m.buy{value: 11 ether}(0);
        assertTrue(m.graduated());
        // buying is frozen...
        vm.prank(carol);
        vm.expectRevert(bytes("GRADUATED"));
        m.buy{value: 1 ether}(0);
        // ...but holders can ALWAYS exit (no stranded funds / no force-graduation griefing).
        uint256 bal = m.balanceOf(bob);
        uint256 before = bob.balance;
        vm.prank(bob);
        m.sell(bal, 0);
        assertGt(bob.balance, before);
        _assertSolvent();
    }

    function test_CannotReinitialize() public {
        vm.expectRevert(bytes("ALREADY_INIT"));
        m.initialize("x", "X", address(registry), deedId, protocol, _defaultCurveConfig());
    }

    // ── views / edges ─────────────────────────────────────────────────────────────
    function test_QuoteSellMatchesSell() public {
        vm.prank(bob);
        m.buy{value: 2 ether}(0);
        uint256 bal = m.balanceOf(bob);
        uint256 q = m.quoteSell(bal);
        uint256 before = bob.balance;
        vm.prank(bob);
        m.sell(bal, 0);
        assertEq(bob.balance - before, q);
    }

    function test_MarketCapAndMetadata() public {
        assertEq(m.name(), "bread");
        assertEq(m.symbol(), "BREAD");
        assertEq(m.marketCapWei(), 0); // nothing circulating yet
        vm.prank(bob);
        m.buy{value: 1 ether}(0);
        assertGt(m.marketCapWei(), 0);
        assertEq(m.quoteBuy(0), 0);
        assertEq(m.quoteSell(0), 0);
    }

    function test_ReceiveReverts() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(m).call{value: 1 ether}("");
        assertFalse(ok); // receive() reverts -> must use buy()
    }

    function test_ZeroAndBalanceGuards() public {
        vm.startPrank(bob);
        vm.expectRevert(bytes("ZERO_ETH"));
        m.buy{value: 0}(0);
        vm.expectRevert(bytes("ZERO_TOKENS"));
        m.sell(0, 0);
        vm.expectRevert(bytes("BALANCE"));
        m.sell(1 ether, 0);
        vm.stopPrank();
    }

    function test_ClaimNothingReverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("NOTHING"));
        m.claimFees();
        vm.prank(protocol);
        vm.expectRevert(bytes("NOTHING"));
        m.claimProtocolFees();
        vm.prank(bob);
        vm.expectRevert(bytes("NOT_PROTOCOL"));
        m.claimProtocolFees();
    }

    // ── SECURITY: solvency — contract always covers every withdrawable claim ───────
    function test_SolvencyAfterManyTrades() public {
        address[3] memory traders = [bob, carol, dave];
        for (uint256 i; i < 9; i++) {
            address t = traders[i % 3];
            vm.prank(t);
            m.buy{value: (i + 1) * 0.1 ether}(0); // total 4.5 ETH, stays under graduation
            _assertSolvent();
        }
        for (uint256 i; i < 3; i++) {
            address t = traders[i];
            uint256 bal = m.balanceOf(t);
            if (bal == 0) continue;
            vm.prank(t);
            m.sell(bal, 0);
            _assertSolvent();
        }
    }

    /// Invariant: the contract's ETH balance always covers the curve reserve + every fee pot,
    /// i.e. no accounting path lets a user (or the deed/protocol) withdraw ETH the contract
    /// doesn't hold. This is the core "can't drain others' funds" guarantee.
    function _assertSolvent() internal view {
        uint256 liabilities =
            m.realEthReserve() + m.protocolFeesAccrued() + m.deedFeesAccrued() + m.liquidityFeesAccrued();
        assertGe(address(m).balance, liabilities, "insolvent");
    }

    /// SECURITY: the registry owner (this test contract) has NO path to a market's curve ETH —
    /// the lesson from the pump.fun exploit (a privileged key drained the curve). WordMarket has no
    /// admin/withdraw at all; the owner isn't even the protocol fee recipient here.
    function test_OwnerCannotTouchCurveFunds() public {
        vm.prank(bob);
        m.buy{value: 5 ether}(0);
        assertEq(registry.owner(), address(this)); // we ARE the owner
        // owner is not the protocol recipient -> can't even claim the protocol fee pot
        vm.expectRevert(bytes("NOT_PROTOCOL"));
        m.claimProtocolFees();
        // owner doesn't hold the deed -> can't claim deed fees
        vm.expectRevert(bytes("NOT_DEED_OWNER"));
        m.claimFees();
        // and there is simply no function to withdraw realEthReserve. It only leaves via sell().
        assertGt(m.realEthReserve(), 0);
    }

    // ── SECURITY: reentrancy on sell is blocked ────────────────────────────────────
    function test_ReentrancyOnSellBlocked() public {
        Attacker atk = new Attacker(m, registry);
        registry.setWhitelisted(address(atk), true); // owner grants the attacker (so it can trade)
        vm.deal(address(atk), 10 ether);
        atk.prime{value: 2 ether}(); // buy some tokens
        // On receiving ETH during sell, the attacker re-enters sell -> nonReentrant must revert,
        // which bubbles up and reverts the whole tx.
        vm.expectRevert();
        atk.attack();
    }
}

import {WordRegistry} from "../src/WordRegistry.sol";

contract Attacker {
    WordMarket public m;
    WordRegistry public registry;
    bool internal attacking;

    constructor(WordMarket m_, WordRegistry r_) {
        m = m_;
        registry = r_;
    }

    function prime() external payable {
        m.buy{value: msg.value}(0);
    }

    function attack() external {
        attacking = true;
        m.sell(m.balanceOf(address(this)), 0);
    }

    receive() external payable {
        if (attacking) {
            attacking = false;
            // re-enter: nonReentrant guard must make this revert
            m.sell(1, 0);
        }
    }
}
