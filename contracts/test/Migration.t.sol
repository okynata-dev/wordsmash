// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Base} from "./Base.t.sol";
import {WordMarket} from "../src/WordMarket.sol";
import {UniV3Migrator, INonfungiblePositionManager, IWETH9} from "../src/UniV3Migrator.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

// ── mocks ───────────────────────────────────────────────────────────────────────

/// Happy-path migrator mock: records what it received, returns a fake pool.
contract MockMigrator {
    address public lastToken;
    uint256 public lastTokenAmount;
    uint256 public lastEth;
    address public constant POOL = address(0xBEEF);

    function migrate(address token, uint256 tokenAmount) external payable returns (address) {
        lastToken = token;
        lastTokenAmount = tokenAmount;
        lastEth = msg.value;
        return POOL;
    }
}

/// Broken migrator: always reverts — migrate() must be atomic against it.
contract RevertingMigrator {
    function migrate(address, uint256) external payable returns (address) {
        revert("BROKEN");
    }
}

contract MockWETH {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }

    function totalSupply() external pure returns (uint256) {
        return 0;
    }
}

/// Minimal Uniswap-v3 pool mock: models "initialize once" semantics so the migrator's
/// anti-front-run price check can be exercised. Pre-initializing it at a skewed price
/// simulates an attacker who created the pool before migration.
contract MockUniPool {
    uint160 public price; // sqrtPriceX96
    bool public initialized;

    /// Mirrors real v3: only the FIRST initialize sets the price; later calls are no-ops.
    function initialize(uint160 sqrtPriceX96) external {
        if (!initialized) {
            price = sqrtPriceX96;
            initialized = true;
        }
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (price, int24(0), uint16(0), uint16(0), uint16(0), uint8(0), false);
    }
}

/// Position manager mock: consumes ~all of both sides (leaves 1 wei dust of token1),
/// records the mint params so the test can assert full-range + dead recipient. Holds a
/// MockUniPool and initializes it via createAndInitializePoolIfNecessary (once-only, like v3).
contract MockPositionManager {
    MockUniPool public poolContract;
    int24 public lastTickLower;
    int24 public lastTickUpper;
    address public lastRecipient;
    uint24 public lastFee;

    constructor() {
        poolContract = new MockUniPool();
    }

    function pool() external view returns (address) {
        return address(poolContract);
    }

    function initPrice() external view returns (uint160) {
        return poolContract.price();
    }

    function createAndInitializePoolIfNecessary(address, address, uint24, uint160 sqrtPriceX96)
        external
        payable
        returns (address)
    {
        poolContract.initialize(sqrtPriceX96); // no-op if an attacker pre-initialized it
        return address(poolContract);
    }

    function mint(INonfungiblePositionManager.MintParams calldata p)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        lastTickLower = p.tickLower;
        lastTickUpper = p.tickUpper;
        lastRecipient = p.recipient;
        lastFee = p.fee;
        amount0 = p.amount0Desired;
        amount1 = p.amount1Desired - 1; // 1 wei dust to exercise the sweep
        IERC20(p.token0).transferFrom(msg.sender, address(this), amount0);
        IERC20(p.token1).transferFrom(msg.sender, address(this), amount1);
        return (777, 1, amount0, amount1);
    }
}

// ── WordMarket.migrate() ─────────────────────────────────────────────────────────

contract MigrationTest is Base {
    WordMarket internal m;
    uint256 internal deedId;
    MockMigrator internal migrator;

    function setUp() public {
        _deploy();
        _enroll(alice);
        _enroll(bob);
        deedId = _claim(alice, "bread");
        m = WordMarket(payable(registry.marketOf("bread")));
        migrator = new MockMigrator();
    }

    function _graduate() internal {
        vm.prank(bob);
        m.buy{value: 11 ether}(0);
        assertTrue(m.graduated());
    }

    function test_InertWithoutMigrator() public {
        _graduate();
        vm.expectRevert(bytes("NO_MIGRATOR"));
        m.migrate();
        // sells keep working exactly as before
        uint256 bal = m.balanceOf(bob);
        vm.prank(bob);
        m.sell(bal / 2, 0);
    }

    function test_MigrateOnlyAfterGraduation() public {
        registry.setMigrator(address(migrator));
        vm.expectRevert(bytes("NOT_GRADUATED"));
        m.migrate();
    }

    /// HIGH-2 regression: migrator is write-once, so a compromised owner cannot repoint
    /// it at a draining adapter after markets have accumulated reserves.
    function test_MigratorIsWriteOnce() public {
        registry.setMigrator(address(migrator));
        MockMigrator evil = new MockMigrator();
        vm.expectRevert(bytes("MIGRATOR_LOCKED"));
        registry.setMigrator(address(evil));
    }

    function test_MigratorRejectsZero() public {
        vm.expectRevert(bytes("ZERO_MIGRATOR"));
        registry.setMigrator(address(0));
    }

    function test_MigrateMovesReserveAndTokens_PermissionlessCrank() public {
        _graduate();
        registry.setMigrator(address(migrator));
        uint256 reserve = m.realEthReserve();
        uint256 curveTokens = m.balanceOf(address(m));
        uint256 pots = m.protocolFeesAccrued() + m.deedFeesOf(alice);

        vm.prank(eve); // a random non-whitelisted address can crank it
        address pool = m.migrate();

        assertEq(pool, migrator.POOL());
        assertEq(m.dexPool(), pool);
        assertTrue(m.migrated());
        assertEq(m.realEthReserve(), 0);
        assertEq(migrator.lastEth(), reserve);
        assertEq(migrator.lastTokenAmount(), curveTokens);
        assertEq(migrator.lastToken(), address(m));
        // fee pots stay behind, fully covered by the remaining balance
        assertGe(address(m).balance, pots);

        // once only
        vm.expectRevert(bytes("ALREADY_MIGRATED"));
        m.migrate();
        // curve sells are closed now (reserve is on the DEX); exits live there
        uint256 bal = m.balanceOf(bob);
        vm.prank(bob);
        vm.expectRevert(bytes("INSUFFICIENT_ETH"));
        m.sell(bal, 0);
        // fee claims still work after migration
        vm.prank(alice);
        m.claimFees();
    }

    function test_MigrateAtomicAgainstBrokenAdapter() public {
        _graduate();
        registry.setMigrator(address(new RevertingMigrator()));
        uint256 reserve = m.realEthReserve();
        vm.expectRevert(); // bubbled from the adapter
        m.migrate();
        // full rollback: nothing moved, market not marked, sells keep working
        assertEq(m.realEthReserve(), reserve);
        assertFalse(m.migrated());
        uint256 bal = m.balanceOf(bob);
        vm.prank(bob);
        m.sell(bal / 2, 0);
    }
}

// ── UniV3Migrator ────────────────────────────────────────────────────────────────

contract UniV3MigratorTest is Base {
    WordMarket internal m;
    MockWETH internal weth;
    MockPositionManager internal pm;
    UniV3Migrator internal migrator;

    function setUp() public {
        _deploy();
        _enroll(alice);
        _enroll(bob);
        _claim(alice, "bread");
        m = WordMarket(payable(registry.marketOf("bread")));
        weth = new MockWETH();
        pm = new MockPositionManager();
        migrator = new UniV3Migrator(
            address(pm), address(weth), address(registry), protocol, 10_000, 200
        );
        registry.setMigrator(address(migrator));
    }

    function test_FullRangeLockedLiquidity() public {
        vm.prank(bob);
        m.buy{value: 11 ether}(0);
        address pool = m.migrate();
        assertEq(pool, pm.pool());

        // full-range ticks snapped to spacing 200, LP minted straight to dead
        assertEq(pm.lastTickLower(), -887200);
        assertEq(pm.lastTickUpper(), 887200);
        assertEq(pm.lastRecipient(), 0x000000000000000000000000000000000000dEaD);
        assertEq(pm.lastFee(), 10_000);
        assertGt(pm.initPrice(), 0);

        // dust (1 wei of token1) swept to the dust receiver, nothing stranded on the adapter
        assertEq(m.balanceOf(address(migrator)), 0);
        assertEq(weth.balanceOf(address(migrator)), 0);
    }

    function test_OnlyGenuineMarketsMayCall() public {
        vm.deal(address(this), 1 ether);
        vm.expectRevert(bytes("NOT_MARKET"));
        migrator.migrate{value: 1 ether}(address(m), 1);
    }

    /// HIGH-1 regression: a pool pre-created at a skewed price must NOT be minted into.
    function test_RevertsOnPreCreatedSkewedPool() public {
        // Attacker initializes the pool at a far-off price before migration; the real
        // v3 createAndInitializePoolIfNecessary would then be a no-op and ignore our price.
        pm.poolContract().initialize(uint160(1));

        vm.prank(bob);
        m.buy{value: 11 ether}(0);
        uint256 reserve = m.realEthReserve();

        vm.expectRevert(bytes("POOL_PRICE_MANIPULATED"));
        m.migrate();

        // Atomic: nothing moved. The market can still migrate later, once the pool is
        // arbitraged back to fair value — funds are never stranded or stolen.
        assertEq(m.realEthReserve(), reserve);
        assertFalse(m.migrated());
        // and the curve exit still works in the meantime
        uint256 bal = m.balanceOf(bob);
        vm.prank(bob);
        m.sell(bal / 2, 0);
    }
}
