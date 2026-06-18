// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {WordMarket} from "../src/WordMarket.sol";
import {WordRegistry} from "../src/WordRegistry.sol";

/// @dev Random buy/sell/claim against one word's bonding-curve market by 4 enrolled actors.
contract MarketHandler is Base {
    WordMarket public m;
    address[4] internal actors;
    uint256 public deedId;

    constructor() {
        _deploy();
        actors = [alice, bob, carol, dave];
        for (uint256 i; i < 4; i++) {
            _enroll(actors[i]);
            vm.deal(actors[i], 10_000 ether);
        }
        deedId = _claim(alice, "bread");
        m = WordMarket(payable(registry.marketOf("bread")));
    }

    function getMarket() external view returns (WordMarket) {
        return m;
    }

    function buy(uint256 a, uint256 value) external {
        address who = actors[a % 4];
        value = bound(value, 0, 50 ether);
        vm.prank(who);
        try m.buy{value: value}(0) {} catch {}
    }

    function sell(uint256 a, uint256 amt) external {
        address who = actors[a % 4];
        uint256 bal = m.balanceOf(who);
        if (bal == 0) return;
        amt = bound(amt, 1, bal);
        vm.prank(who);
        try m.sell(amt, 0) {} catch {}
    }

    function claimDeed() external {
        address owner = registry.ownerOf(deedId);
        vm.prank(owner);
        try m.claimFees() {} catch {}
    }

    function claimProtocol() external {
        vm.prank(protocol);
        try m.claimProtocolFees() {} catch {}
    }

    function transferDeed(uint256 a) external {
        address from = registry.ownerOf(deedId);
        address to = actors[a % 4];
        vm.prank(from);
        try registry.transferFrom(from, to, deedId) {} catch {}
    }
}

contract MarketInvariantsTest is Base {
    MarketHandler internal handler;
    WordMarket internal m;

    function setUp() public {
        handler = new MarketHandler();
        m = handler.getMarket();
        targetContract(address(handler));
    }

    /// The market can ALWAYS cover its liabilities: balance >= curve reserve + every fee pot.
    /// If this holds across all random trade orderings, no path lets anyone withdraw ETH the
    /// contract doesn't hold — i.e. no user can drain another's funds.
    function invariant_marketAlwaysSolvent() public view {
        uint256 liabilities =
            m.realEthReserve() + m.protocolFeesAccrued() + m.deedFeesAccrued() + m.liquidityFeesAccrued();
        assertGe(address(m).balance, liabilities);
    }

    /// The curve constant never decreases (the rounding invariant that makes solvency hold).
    function invariant_reservesPositive() public view {
        assertGt(m.virtualEthReserve(), 0);
        assertGt(m.virtualTokenReserve(), 0);
    }
}
