// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IDeedRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
    function isAllowed(address account) external view returns (bool);
    function paused() external view returns (bool);
    function migrator() external view returns (address);
}

interface IMigrator {
    /// @notice Receive a graduated market's reserve ETH (msg.value) + remaining curve
    ///         tokens and create locked DEX liquidity. MUST revert on any failure —
    ///         migrate() is atomic; funds never strand half-way.
    function migrate(address token, uint256 tokenAmount) external payable returns (address pool);
}

/// @title WordMarket (v2)
/// @notice Per-word fungible token on a virtual-reserve constant-product bonding curve (pump.fun
///         style). Claiming a word deploys one of these clones (EIP-1167) and the curve holds the
///         whole supply; people buy/sell against it. ~1% trade fee is split protocol / deed-owner /
///         liquidity, and the deed-owner share accrues to whoever currently holds the word's deed —
///         so the deed is a cash-flowing asset.
/// @dev    SECURITY: every ETH-moving path is `nonReentrant` and follows checks-effects-interactions
///         (reserves + fee pots are updated before any transfer/send). Reserve-out is computed with
///         CEILING division so the curve constant never decreases on a trade — this guarantees
///         `realEthReserve` always covers what sellers can withdraw (no path lets a user extract more
///         ETH than the curve holds, so nobody can drain another user's funds).
contract WordMarket is ERC20, ReentrancyGuard {
    struct Config {
        uint16 tradeFeeBps; // total trade fee, e.g. 100 = 1%
        uint16 protocolBps; // share of fee to protocol (of 10000)
        uint16 deedBps; // share of fee to the deed owner
        uint16 liquidityBps; // share of fee retained as liquidity
        uint256 tokenSupply; // fixed total supply, all minted to the curve
        uint256 virtualEthReserve; // initial virtual ETH reserve (sets starting price)
        uint256 graduationThreshold; // real ETH in curve that freezes trading
    }

    uint256 internal constant BPS = 10_000;

    string private _tokenName;
    string private _tokenSymbol;

    bool public initialized;
    IDeedRegistry public registry; // the WordRegistry (deed ERC-721 + whitelist gate)
    uint256 public deedTokenId;
    address public protocolFeeRecipient;

    uint256 public virtualEthReserve;
    uint256 public virtualTokenReserve;
    uint256 public realEthReserve; // actual ETH backing the curve (excludes fee pots)
    uint256 public graduationThreshold;
    bool public graduated;
    bool public migrated; // liquidity moved to the DEX (see migrate())
    address public dexPool; // the pool created at migration (address(0) until then)

    uint16 public tradeFeeBps;
    uint16 public protocolBps;
    uint16 public deedBps;
    uint16 public liquidityBps;
    /// @notice Deed-owner fee share, accounted PER OWNER AT ACCRUAL TIME. Selling the deed
    ///         no longer donates the unclaimed pot to the buyer: what you earned while you
    ///         held the deed stays claimable by you, forever. (The liquidity share is folded
    ///         straight into `realEthReserve` — it deepens the curve instead of stranding.)
    mapping(address => uint256) public deedFeesOf;
    uint256 public protocolFeesAccrued;

    /// @notice Gross ETH volume: msg.value on buys + gross curve outflow on sells (same
    ///         basis as the Trade event, so on-chain and indexed volume always agree).
    uint256 public totalEthVolume;

    event Trade(address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 newPrice);
    event DeedFeesClaimed(address indexed to, uint256 amount);
    event ProtocolFeesClaimed(address indexed to, uint256 amount);
    event Graduated(uint256 realEthReserve);
    event Migrated(address indexed migrator, address indexed pool, uint256 ethAmount, uint256 tokenAmount);

    /// @dev Lock the implementation (clone template) so it can never be initialized directly.
    ///      Clones (EIP-1167) get their own fresh storage and run `initialize` normally; this only
    ///      seals the logic contract itself, matching OZ's `_disableInitializers` hygiene.
    constructor() ERC20("", "") {
        initialized = true;
    }

    function initialize(
        string memory name_,
        string memory symbol_,
        address registry_,
        uint256 deedTokenId_,
        address protocolFeeRecipient_,
        Config memory cfg
    ) external {
        require(!initialized, "ALREADY_INIT");
        require(protocolFeeRecipient_ != address(0), "ZERO_RECIPIENT");
        require(cfg.protocolBps + cfg.deedBps + cfg.liquidityBps == BPS, "BAD_SPLIT");
        require(cfg.tradeFeeBps <= 1000, "FEE_TOO_HIGH");
        require(cfg.tokenSupply > 0 && cfg.virtualEthReserve > 0, "BAD_CURVE");
        initialized = true;

        _tokenName = name_;
        _tokenSymbol = symbol_;
        registry = IDeedRegistry(registry_);
        deedTokenId = deedTokenId_;
        protocolFeeRecipient = protocolFeeRecipient_;

        tradeFeeBps = cfg.tradeFeeBps;
        protocolBps = cfg.protocolBps;
        deedBps = cfg.deedBps;
        liquidityBps = cfg.liquidityBps;
        graduationThreshold = cfg.graduationThreshold;

        virtualEthReserve = cfg.virtualEthReserve;
        virtualTokenReserve = cfg.tokenSupply;
        _mint(address(this), cfg.tokenSupply);
    }

    // clones start with empty ERC20 storage; serve our own name/symbol
    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    // ── trading ───────────────────────────────────────────────────────────────

    /// @notice Buy tokens with ETH. Fee taken from msg.value; remainder enters the curve.
    /// @dev Pausable via the registry's emergency switch. Only ENTRIES pause — sell(),
    ///      claimFees() and every withdrawal stay live so a pause can never trap funds.
    function buy(uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(!graduated, "GRADUATED");
        require(!registry.paused(), "PAUSED");
        require(registry.isAllowed(msg.sender), "NOT_WHITELISTED");
        require(msg.value > 0, "ZERO_ETH");

        uint256 fee = (msg.value * tradeFeeBps) / BPS;
        uint256 ethIn = msg.value - fee;

        uint256 k = virtualEthReserve * virtualTokenReserve;
        uint256 newEthReserve = virtualEthReserve + ethIn;
        // round the new token reserve UP so the buyer gets marginally fewer tokens and the curve
        // constant never decreases -> realEthReserve stays solvent against the last seller.
        uint256 newTokenReserve = _ceilDiv(k, newEthReserve);
        tokensOut = virtualTokenReserve - newTokenReserve;
        require(tokensOut >= minTokensOut, "SLIPPAGE");
        require(tokensOut > 0 && tokensOut <= balanceOf(address(this)), "INSUFFICIENT_LIQ");

        virtualEthReserve = newEthReserve;
        virtualTokenReserve = newTokenReserve;
        realEthReserve += ethIn;
        totalEthVolume += msg.value; // gross, matching the Trade event
        _splitFee(fee);

        _transfer(address(this), msg.sender, tokensOut);

        if (!graduated && realEthReserve >= graduationThreshold) {
            graduated = true;
            emit Graduated(realEthReserve);
        }
        emit Trade(msg.sender, true, msg.value, tokensOut, currentPrice());
    }

    /// @notice Sell tokens back to the curve for ETH. Fee taken from the ETH proceeds.
    /// @dev Selling stays open after graduation, so holders can ALWAYS exit: before
    ///      migration they exit here; after migrate() empties the reserve into a locked
    ///      DEX pool, sells here revert (INSUFFICIENT_ETH) and the exit lives on the DEX.
    ///      Either way there is never a moment without a permissionless exit.
    ///      DELIBERATELY UNGATED: no whitelist and no pause. The exit is permissionless by
    ///      construction — no admin action, gate flip or emergency switch can ever freeze a
    ///      holder's ability to sell. Tokens are plain ERC-20 and routinely reach wallets that
    ///      never enrolled; their money must not depend on anyone's allowlist state.
    function sell(uint256 tokenAmount, uint256 minEthOut) external nonReentrant returns (uint256 ethToSeller) {
        require(tokenAmount > 0, "ZERO_TOKENS");
        require(balanceOf(msg.sender) >= tokenAmount, "BALANCE");

        uint256 k = virtualEthReserve * virtualTokenReserve;
        uint256 newTokenReserve = virtualTokenReserve + tokenAmount;
        // round the new ETH reserve UP so the seller receives marginally less (solvency mirror).
        uint256 newEthReserve = _ceilDiv(k, newTokenReserve);
        uint256 grossEthOut = virtualEthReserve - newEthReserve;
        require(grossEthOut > 0 && grossEthOut <= realEthReserve, "INSUFFICIENT_ETH");

        uint256 fee = (grossEthOut * tradeFeeBps) / BPS;
        ethToSeller = grossEthOut - fee;
        require(ethToSeller >= minEthOut, "SLIPPAGE");

        // effects first
        virtualEthReserve = newEthReserve;
        virtualTokenReserve = newTokenReserve;
        realEthReserve -= grossEthOut;
        totalEthVolume += grossEthOut;
        _transfer(msg.sender, address(this), tokenAmount);
        _splitFee(fee);

        // interaction last
        (bool sent,) = msg.sender.call{value: ethToSeller}("");
        require(sent, "ETH_SEND_FAIL");
        emit Trade(msg.sender, false, grossEthOut, tokenAmount, currentPrice()); // gross, like buys
    }

    function _splitFee(uint256 fee) private {
        if (fee == 0) return;
        uint256 toProtocol = (fee * protocolBps) / BPS;
        uint256 toDeed = (fee * deedBps) / BPS;
        uint256 toLiquidity = fee - toProtocol - toDeed; // remainder avoids dust loss
        protocolFeesAccrued += toProtocol;
        // Credit the deed share to whoever holds the deed RIGHT NOW — selling the deed
        // later moves only FUTURE fees to the buyer, never the already-earned pot.
        deedFeesOf[registry.ownerOf(deedTokenId)] += toDeed;
        // The liquidity share deepens the curve's real backing instead of stranding in a
        // pot nothing can spend: it counts toward graduation and cushions seller exits.
        realEthReserve += toLiquidity;
    }

    // ── graduation → DEX migration ─────────────────────────────────────────────

    /// @notice Move a graduated market's liquidity to a DEX pool. Permissionless crank:
    ///         once graduated, ANYONE may trigger it — no admin needed, no admin able to
    ///         block it (censorship-resistance for the exit path). Atomic and once-only:
    ///         if the migrator can't mint the pool position, everything reverts and the
    ///         curve keeps working exactly as before. Inert until the registry owner
    ///         wires a migrator, so the feature can ship dark and be enabled post-audit.
    /// @dev    After migration the curve's reserve is zero, so sell() naturally closes
    ///         (INSUFFICIENT_ETH) — holders exit on the DEX instead, where the liquidity
    ///         position is locked forever (the migrator burns the LP to a dead address).
    ///         Fee pots (deedFeesOf / protocolFeesAccrued) are untouched and stay
    ///         claimable here forever.
    function migrate() external nonReentrant returns (address pool) {
        require(graduated, "NOT_GRADUATED");
        require(!migrated, "ALREADY_MIGRATED");
        address migrator_ = registry.migrator();
        require(migrator_ != address(0), "NO_MIGRATOR");

        migrated = true;
        uint256 ethAmount = realEthReserve;
        realEthReserve = 0;
        uint256 tokenAmount = balanceOf(address(this));
        if (tokenAmount > 0) _transfer(address(this), migrator_, tokenAmount);

        pool = IMigrator(migrator_).migrate{value: ethAmount}(address(this), tokenAmount);
        require(pool != address(0), "MIGRATION_FAILED");
        dexPool = pool;
        emit Migrated(migrator_, pool, ethAmount, tokenAmount);
    }

    // ── fee withdrawal ─────────────────────────────────────────────────────────

    /// @notice Withdraw YOUR accrued deed-owner fee share. Callable by anyone with a
    ///         balance (current holder, or a past holder who never claimed) — always live.
    function claimFees() external nonReentrant returns (uint256 amount) {
        amount = deedFeesOf[msg.sender];
        require(amount > 0, "NOTHING");
        deedFeesOf[msg.sender] = 0;
        (bool sent,) = msg.sender.call{value: amount}("");
        require(sent, "ETH_SEND_FAIL");
        emit DeedFeesClaimed(msg.sender, amount);
    }

    /// @notice Back-compat convenience: the CURRENT deed holder's claimable pot (what the
    ///         word page and profile earnings surfaces display).
    function deedFeesAccrued() external view returns (uint256) {
        return deedFeesOf[registry.ownerOf(deedTokenId)];
    }

    function claimProtocolFees() external nonReentrant returns (uint256 amount) {
        require(msg.sender == protocolFeeRecipient, "NOT_PROTOCOL");
        amount = protocolFeesAccrued;
        require(amount > 0, "NOTHING");
        protocolFeesAccrued = 0;
        (bool sent,) = protocolFeeRecipient.call{value: amount}("");
        require(sent, "ETH_SEND_FAIL");
        emit ProtocolFeesClaimed(protocolFeeRecipient, amount);
    }

    // ── views / quotes ─────────────────────────────────────────────────────────

    function currentPrice() public view returns (uint256) {
        if (virtualTokenReserve == 0) return 0;
        return (virtualEthReserve * 1e18) / virtualTokenReserve;
    }

    function quoteBuy(uint256 ethValue) external view returns (uint256 tokensOut) {
        if (ethValue == 0 || graduated) return 0;
        uint256 fee = (ethValue * tradeFeeBps) / BPS;
        uint256 ethIn = ethValue - fee;
        uint256 k = virtualEthReserve * virtualTokenReserve;
        tokensOut = virtualTokenReserve - _ceilDiv(k, virtualEthReserve + ethIn);
    }

    function quoteSell(uint256 tokenAmount) external view returns (uint256 ethOut) {
        if (tokenAmount == 0 || graduated) return 0;
        uint256 k = virtualEthReserve * virtualTokenReserve;
        uint256 grossEthOut = virtualEthReserve - _ceilDiv(k, virtualTokenReserve + tokenAmount);
        uint256 fee = (grossEthOut * tradeFeeBps) / BPS;
        ethOut = grossEthOut - fee;
    }

    /// @notice Market cap proxy = circulating tokens * spot price (wei).
    function marketCapWei() external view returns (uint256) {
        uint256 circulating = totalSupply() - balanceOf(address(this));
        return (circulating * currentPrice()) / 1e18;
    }

    function deedOwner() external view returns (address) {
        return registry.ownerOf(deedTokenId);
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    receive() external payable {
        revert("USE_BUY");
    }
}
