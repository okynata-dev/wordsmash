// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external
        payable
        returns (address pool);

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IWETH9 is IERC20 {
    function deposit() external payable;
}

interface IMarketRegistry {
    function deedOfMarket(address market) external view returns (uint256);
}

/// @title UniV3Migrator
/// @notice Turns a graduated word market's reserve (ETH + remaining curve tokens) into a
///         FULL-RANGE Uniswap v3 position whose LP NFT is minted straight to the dead
///         address — the liquidity is locked forever, so a rug via LP pull is structurally
///         impossible. Called only by genuine WordMarket clones (verified via the registry)
///         inside their atomic migrate(); any failure here reverts the whole migration and
///         the curve keeps working.
contract UniV3Migrator is ReentrancyGuard {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    INonfungiblePositionManager public immutable positionManager;
    IWETH9 public immutable weth;
    IMarketRegistry public immutable registry;
    address public immutable dustReceiver; // sub-wei-of-liquidity leftovers (mint rarely consumes 100%)
    uint24 public immutable feeTier;
    int24 public immutable tickLower;
    int24 public immutable tickUpper;

    event LiquidityLocked(
        address indexed market, address indexed pool, uint256 lpTokenId, uint256 wethUsed, uint256 tokenUsed
    );

    constructor(
        address positionManager_,
        address weth_,
        address registry_,
        address dustReceiver_,
        uint24 feeTier_,
        int24 tickSpacing_
    ) {
        require(
            positionManager_ != address(0) && weth_ != address(0) && registry_ != address(0)
                && dustReceiver_ != address(0),
            "ZERO_ADDR"
        );
        positionManager = INonfungiblePositionManager(positionManager_);
        weth = IWETH9(weth_);
        registry = IMarketRegistry(registry_);
        dustReceiver = dustReceiver_;
        feeTier = feeTier_;
        // Full range, snapped to the tick spacing (MIN/MAX tick is ±887272).
        int24 maxTick = (887272 / tickSpacing_) * tickSpacing_;
        tickLower = -maxTick;
        tickUpper = maxTick;
    }

    /// @notice See WordMarket.migrate(). msg.value = the curve's reserve ETH;
    ///         `tokenAmount` tokens were transferred to this contract beforehand.
    function migrate(address token, uint256 tokenAmount) external payable nonReentrant returns (address pool) {
        require(registry.deedOfMarket(msg.sender) != 0, "NOT_MARKET");
        require(token == msg.sender, "TOKEN_MISMATCH"); // the market IS its own ERC-20
        require(msg.value > 0 && tokenAmount > 0, "EMPTY");

        weth.deposit{value: msg.value}();

        (address token0, address token1) = address(weth) < token ? (address(weth), token) : (token, address(weth));
        (uint256 amount0, uint256 amount1) =
            token0 == address(weth) ? (msg.value, tokenAmount) : (tokenAmount, msg.value);

        // Initial price from the exact reserve ratio: sqrtPriceX96 = sqrt(amount1/amount0) * 2^96.
        // sqrt((amount1 << 96) / amount0) is Q48; shift 48 more for Q96. amount1 <= 1e27 so
        // amount1 << 96 (~1e56) can't overflow uint256.
        uint160 sqrtPriceX96 = uint160(_sqrt((amount1 << 96) / amount0) << 48);
        require(sqrtPriceX96 > 0, "BAD_PRICE");

        pool = positionManager.createAndInitializePoolIfNecessary(token0, token1, feeTier, sqrtPriceX96);

        IERC20(token0).approve(address(positionManager), amount0);
        IERC20(token1).approve(address(positionManager), amount1);

        // LP NFT minted DIRECTLY to the dead address — locked forever, no custody moment.
        (uint256 lpTokenId,, uint256 used0, uint256 used1) = positionManager.mint(
            INonfungiblePositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: feeTier,
                tickLower: tickLower,
                tickUpper: tickUpper,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min: 0, // atomic single-tx create+mint at our own initial price — no sandwich window
                amount1Min: 0,
                recipient: DEAD,
                deadline: block.timestamp
            })
        );

        // Sweep whatever the mint didn't consume (rounding dust) — nothing may strand here.
        _sweep(IERC20(token0), amount0 - used0);
        _sweep(IERC20(token1), amount1 - used1);

        emit LiquidityLocked(msg.sender, pool, lpTokenId, token0 == address(weth) ? used0 : used1, token0 == address(weth) ? used1 : used0);
    }

    function _sweep(IERC20 t, uint256 amount) private {
        if (amount > 0) {
            require(t.transfer(dustReceiver, amount), "SWEEP_FAIL");
        }
    }

    function _sqrt(uint256 x) private pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
