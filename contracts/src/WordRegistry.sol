// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {WordNormalizer} from "./libraries/WordNormalizer.sol";
import {WordMarket} from "./WordMarket.sol";

/// @title WordRegistry
/// @notice v1 launchpad core. The registry IS the deed ERC-721: claiming a word enforces global
///         uniqueness, charges a flat fee, and mints the word's deed. There is no token trading in
///         v1 (bonding curve is v2, post-audit).
/// @dev    A word can be claimed once, ever. tokenId = uint256(keccak256(normalizedWord)).
///         A single shared whitelist (Merkle-gated, cached on enrollment) governs claim + transfers
///         and is also consulted by the DeedMarketplace, so it is the one source of truth for the
///         closed beta. `whitelistEnabled` flips the whole gate off in one tx for public launch.
contract WordRegistry is ERC721, Ownable, ReentrancyGuard {
    using WordNormalizer for string;

    // --- fees (pull pattern) ---
    address public protocolFeeReceiver;
    uint256 public claimFee;
    uint256 public accruedFees;

    // --- whitelist gate (closed beta) ---
    bytes32 public whitelistRoot;
    bool public whitelistEnabled = true;
    mapping(address => bool) public isWhitelisted; // cached after enrollment via verifyWhitelist

    // --- emergency switch ---
    /// @notice Pauses ENTRIES only: claim() here, buy() on every market clone, and
    ///         list()/buy() on the marketplace (all consult this flag). Exits are
    ///         deliberately unpausable — sell(), claimFees() and every withdrawal keep
    ///         working, so a pause can never trap user funds.
    bool public paused;

    // --- anti-bot claim limit ---
    uint256 public maxClaimsPerAddress; // 0 = unlimited
    mapping(address => uint256) public claimsBy; // monotonic mint count, cannot be reset by transfer

    // --- registry state ---
    mapping(bytes32 => bool) public isReserved; // keccak256(normalizedWord) => reserved
    mapping(uint256 => string) public wordOf; // tokenId => normalized word
    mapping(string => uint256) private _tokenIdOf; // normalized word => tokenId (0 if unclaimed)
    uint256[] public allTokenIds;

    // --- v2: per-word bonding-curve market ---
    address public immutable marketImplementation; // WordMarket logic, cloned per word
    WordMarket.Config public marketConfig;
    mapping(uint256 => address) public marketOfTokenId; // deed tokenId => market clone
    mapping(address => uint256) public deedOfMarket; // market clone => deed tokenId

    event WordClaimed(string word, uint256 indexed tokenId, address indexed owner, address market);
    event Reserved(string word, bool reserved);
    event Whitelisted(address indexed account);
    event WhitelistRevoked(address indexed account);
    event WhitelistRootUpdated(bytes32 root);
    event WhitelistEnabledUpdated(bool enabled);
    event ClaimFeeUpdated(uint256 fee);
    event MaxClaimsUpdated(uint256 max);
    event ProtocolFeeReceiverUpdated(address receiver);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event PausedUpdated(bool paused);

    constructor(
        address protocolFeeReceiver_,
        uint256 claimFee_,
        uint256 maxClaimsPerAddress_,
        bytes32 whitelistRoot_,
        address marketImplementation_,
        WordMarket.Config memory marketConfig_
    ) ERC721("Word Deed", "DEED") Ownable(msg.sender) {
        require(protocolFeeReceiver_ != address(0), "ZERO_RECEIVER");
        require(marketImplementation_ != address(0), "ZERO_IMPL");
        require(
            marketConfig_.protocolBps + marketConfig_.deedBps + marketConfig_.liquidityBps == 10_000, "BAD_SPLIT"
        );
        protocolFeeReceiver = protocolFeeReceiver_;
        claimFee = claimFee_;
        maxClaimsPerAddress = maxClaimsPerAddress_;
        whitelistRoot = whitelistRoot_;
        marketImplementation = marketImplementation_;
        marketConfig = marketConfig_;
    }

    // ----------------------------------------------------------------------------
    // Whitelist
    // ----------------------------------------------------------------------------

    /// @notice True when `account` may claim / hold / trade deeds.
    function isAllowed(address account) public view returns (bool) {
        return !whitelistEnabled || isWhitelisted[account];
    }

    /// @notice Enroll msg.sender by proving membership in the off-chain whitelist. Idempotent.
    ///         Caching a bool lets cheap repeated checks (and transfer gating, which can't carry a
    ///         proof) work without re-verifying the proof every time.
    function verifyWhitelist(bytes32[] calldata proof) external {
        if (!isWhitelisted[msg.sender]) {
            bytes32 leaf = keccak256(abi.encodePacked(msg.sender));
            require(MerkleProof.verify(proof, whitelistRoot, leaf), "BAD_PROOF");
            isWhitelisted[msg.sender] = true;
            emit Whitelisted(msg.sender);
        }
    }

    // ----------------------------------------------------------------------------
    // Claim
    // ----------------------------------------------------------------------------

    /// @notice Claim a unique word: mints its deed AND deploys its bonding-curve token market.
    /// @dev Accepts plaintext claims, which are front-runnable (a bot can copy the word from a
    ///      pending tx and claim it first). The closed-beta whitelist limits who can do this; a
    ///      commit-reveal scheme is the planned mitigation for the public launch.
    function claim(string calldata rawWord)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, address market)
    {
        require(!paused, "PAUSED");
        require(isAllowed(msg.sender), "NOT_WHITELISTED");

        (string memory word, bool valid) = rawWord.normalize();
        require(valid, "INVALID_WORD");

        bytes32 key = keccak256(bytes(word));
        require(!isReserved[key], "RESERVED");

        tokenId = uint256(key);
        require(_tokenIdOf[word] == 0 && !_exists(tokenId), "ALREADY_CLAIMED");

        if (maxClaimsPerAddress != 0) {
            require(claimsBy[msg.sender] < maxClaimsPerAddress, "CLAIM_LIMIT");
        }
        require(msg.value >= claimFee, "INSUFFICIENT_FEE");

        // Effects before any external call (CEI + nonReentrant).
        claimsBy[msg.sender] += 1;
        wordOf[tokenId] = word;
        _tokenIdOf[word] = tokenId;
        allTokenIds.push(tokenId);
        accruedFees += claimFee;

        _safeMint(msg.sender, tokenId);

        // Deploy the per-word bonding-curve market (EIP-1167 clone) and seed it with the supply.
        market = Clones.clone(marketImplementation);
        marketOfTokenId[tokenId] = market;
        deedOfMarket[market] = tokenId;
        WordMarket(payable(market)).initialize(
            word, WordNormalizer.toUpper(word), address(this), tokenId, protocolFeeReceiver, marketConfig
        );

        emit WordClaimed(word, tokenId, msg.sender, market);

        uint256 refund = msg.value - claimFee;
        if (refund > 0) {
            (bool ok,) = msg.sender.call{value: refund}("");
            require(ok, "REFUND_FAIL");
        }
    }

    // ----------------------------------------------------------------------------
    // Transfer gate (whitelist applies to every deed movement during beta)
    // ----------------------------------------------------------------------------

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Gate real transfers (not mint `from==0`, not burn `to==0`). Both parties must be allowed.
        if (whitelistEnabled && from != address(0) && to != address(0)) {
            require(isWhitelisted[from] && isWhitelisted[to], "NOT_WHITELISTED");
        }
        return super._update(to, tokenId, auth);
    }

    // ----------------------------------------------------------------------------
    // Views
    // ----------------------------------------------------------------------------

    function tokenIdOf(string calldata rawWord) external view returns (uint256) {
        (string memory word, bool valid) = rawWord.normalize();
        if (!valid) return 0;
        return _tokenIdOf[word];
    }

    /// @notice The bonding-curve market address for a word (address(0) if unclaimed/invalid).
    function marketOf(string calldata rawWord) external view returns (address) {
        (string memory word, bool valid) = rawWord.normalize();
        if (!valid) return address(0);
        return marketOfTokenId[_tokenIdOf[word]];
    }

    function isClaimed(string calldata rawWord) public view returns (bool) {
        (string memory word, bool valid) = rawWord.normalize();
        if (!valid) return false;
        return _tokenIdOf[word] != 0;
    }

    /// @notice Normalize + availability for the claim UI (no tx).
    function checkAvailability(string calldata rawWord)
        external
        view
        returns (bool valid, bool available, string memory normalized)
    {
        (normalized, valid) = rawWord.normalize();
        if (!valid) return (false, false, "");
        bytes32 key = keccak256(bytes(normalized));
        available = (_tokenIdOf[normalized] == 0) && !isReserved[key];
    }

    function remainingClaims(address account) external view returns (uint256) {
        if (maxClaimsPerAddress == 0) return type(uint256).max;
        uint256 used = claimsBy[account];
        return used >= maxClaimsPerAddress ? 0 : maxClaimsPerAddress - used;
    }

    function totalWords() external view returns (uint256) {
        return allTokenIds.length;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        // v1 metadata is the word only — no image, no description.
        return string.concat('{"name":"', wordOf[tokenId], '"}');
    }

    function _exists(uint256 tokenId) internal view returns (bool) {
        return _ownerOf(tokenId) != address(0);
    }

    // ----------------------------------------------------------------------------
    // Owner admin (owner is the deployer; in production this is a multisig — HUMAN TASK)
    // ----------------------------------------------------------------------------

    function setReserved(string calldata rawWord, bool reserved) public onlyOwner {
        (string memory word, bool valid) = rawWord.normalize();
        require(valid, "INVALID_WORD");
        isReserved[keccak256(bytes(word))] = reserved;
        emit Reserved(word, reserved);
    }

    function setReservedBatch(string[] calldata rawWords, bool reserved) external onlyOwner {
        for (uint256 i = 0; i < rawWords.length; i++) {
            setReserved(rawWords[i], reserved);
        }
    }

    function setWhitelistRoot(bytes32 root) external onlyOwner {
        whitelistRoot = root;
        emit WhitelistRootUpdated(root);
    }

    function setWhitelistEnabled(bool enabled) external onlyOwner {
        whitelistEnabled = enabled;
        emit WhitelistEnabledUpdated(enabled);
    }

    /// @notice Owner can directly grant/revoke whitelist membership. This is the rescue + revoke
    ///         path: it un-strands deeds held by addresses that acquired them while the gate was
    ///         off (their cached bool was never set), and it lets the owner revoke an abusive
    ///         address that a root rotation alone cannot (cached bools are never auto-cleared).
    function setWhitelisted(address account, bool status) public onlyOwner {
        isWhitelisted[account] = status;
        if (status) emit Whitelisted(account);
        else emit WhitelistRevoked(account);
    }

    function setWhitelistedBatch(address[] calldata accounts, bool status) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            setWhitelisted(accounts[i], status);
        }
    }

    function setClaimFee(uint256 fee) external onlyOwner {
        claimFee = fee;
        emit ClaimFeeUpdated(fee);
    }

    function setMaxClaimsPerAddress(uint256 max) external onlyOwner {
        maxClaimsPerAddress = max;
        emit MaxClaimsUpdated(max);
    }

    /// @notice Emergency switch for ENTRIES (claims, market buys, marketplace list/buy).
    ///         Cannot pause exits — see the `paused` docs.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedUpdated(paused_);
    }

    /// @notice Update the curve config used for FUTURE claims (existing markets keep their own).
    function setMarketConfig(WordMarket.Config calldata cfg) external onlyOwner {
        require(cfg.protocolBps + cfg.deedBps + cfg.liquidityBps == 10_000, "BAD_SPLIT");
        marketConfig = cfg;
    }

    function setProtocolFeeReceiver(address receiver) external onlyOwner {
        require(receiver != address(0), "ZERO_RECEIVER");
        protocolFeeReceiver = receiver;
        emit ProtocolFeeReceiverUpdated(receiver);
    }

    /// @notice Pull accrued claim fees to the protocol receiver.
    function withdrawFees() external nonReentrant {
        require(msg.sender == owner() || msg.sender == protocolFeeReceiver, "NOT_AUTHORIZED");
        uint256 amount = accruedFees;
        require(amount > 0, "NOTHING");
        accruedFees = 0;
        (bool ok,) = protocolFeeReceiver.call{value: amount}("");
        require(ok, "WITHDRAW_FAIL");
        emit FeesWithdrawn(protocolFeeReceiver, amount);
    }
}
