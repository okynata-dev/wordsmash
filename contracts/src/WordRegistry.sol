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

    // --- commit-reveal claims (anti mempool-sniping) ---
    /// @notice When enabled, plaintext claim() is closed and words are claimed in two
    ///         steps: commitClaim(keccak256(word ‖ sender ‖ salt)) → wait commitMinDelay →
    ///         claimWithCommit(word, salt). A bot that copies the reveal from the mempool
    ///         cannot front-run it: winning requires an OLDER commitment for the same
    ///         (word, THEIR address, salt) — which they couldn't have made without knowing
    ///         the word before the victim revealed it. Off during the closed beta (the
    ///         whitelist already bounds snipers); flip on for the open/public launch.
    bool public commitRevealEnabled;
    uint256 public commitMinDelay = 30 seconds;
    uint256 public constant COMMIT_MAX_AGE = 1 days;
    mapping(bytes32 => uint256) public commitTimestamps; // commitment hash => timestamp

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
    /// @notice DEX-migration adapter consulted by every market's migrate(). address(0)
    ///         keeps migration dormant (graduated markets simply keep sells open).
    address public migrator;
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
    event CommitRevealUpdated(bool enabled, uint256 minDelay);
    event ClaimCommitted(bytes32 indexed commitment);
    event MigratorUpdated(address migrator);

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
    /// @dev Plaintext path — front-runnable by mempool bots, so it is only open while
    ///      commitRevealEnabled is off (closed beta, where the whitelist bounds snipers).
    ///      The public-launch path is commitClaim() → claimWithCommit().
    function claim(string calldata rawWord)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, address market)
    {
        // Plaintext claims close when commit-reveal is on — otherwise the two-step
        // protection would be trivially bypassed by calling this instead.
        require(!commitRevealEnabled, "USE_COMMIT_REVEAL");
        return _claim(rawWord);
    }

    /// @notice Step 1 of a snipe-proof claim: commit the hash of what you'll claim.
    ///         commitment = keccak256(abi.encodePacked(normalizedWord, msg.sender, salt)).
    ///         Binding msg.sender inside the hash makes commitments non-transferable —
    ///         copying someone's commitment does a bot no good.
    function commitClaim(bytes32 commitment) external {
        require(!paused, "PAUSED");
        commitTimestamps[commitment] = block.timestamp;
        emit ClaimCommitted(commitment);
    }

    /// @notice Step 2: reveal and claim. Works whether or not commit-reveal is enforced
    ///         (so clients can always use the safe path). The commitment must be older
    ///         than commitMinDelay — a mempool sniper who first learns the word from THIS
    ///         tx cannot have an aged commitment for their own address — and younger than
    ///         COMMIT_MAX_AGE (stale commitments can't be hoarded forever).
    function claimWithCommit(string calldata rawWord, bytes32 salt)
        external
        payable
        nonReentrant
        returns (uint256 tokenId, address market)
    {
        (string memory word, bool valid) = rawWord.normalize();
        require(valid, "INVALID_WORD");
        bytes32 commitment = keccak256(abi.encodePacked(word, msg.sender, salt));
        uint256 committedAt = commitTimestamps[commitment];
        require(committedAt != 0, "NO_COMMIT");
        require(block.timestamp >= committedAt + commitMinDelay, "COMMIT_TOO_NEW");
        require(block.timestamp <= committedAt + COMMIT_MAX_AGE, "COMMIT_EXPIRED");
        delete commitTimestamps[commitment]; // consume exactly once
        return _claim(rawWord);
    }

    function _claim(string calldata rawWord) private returns (uint256 tokenId, address market) {
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

    /// @notice Wire the DEX-migration adapter used by graduated markets. WRITE-ONCE:
    ///         once set to a non-zero address it can never be changed. This closes an
    ///         owner-key-compromise path — migrate() forwards a graduated market's whole
    ///         reserve (buyers' ETH) to this address, so a swappable migrator would let a
    ///         malicious owner point it at a draining contract and crank every market. The
    ///         one and only migrator must be the audited adapter (which locks LP to dead).
    ///         Swapping adapters later requires a new registry — an intentional, heavy
    ///         governance event, not a hot owner switch. Setting it never moves funds by
    ///         itself; migrate() is a public per-market crank, atomic against a broken adapter.
    function setMigrator(address migrator_) external onlyOwner {
        require(migrator == address(0), "MIGRATOR_LOCKED");
        require(migrator_ != address(0), "ZERO_MIGRATOR");
        migrator = migrator_;
        emit MigratorUpdated(migrator_);
    }

    /// @notice Toggle snipe-proof claims and tune the commit age window (bounded so the
    ///         owner can neither disable the delay nor lock claims behind an absurd one).
    function setCommitReveal(bool enabled, uint256 minDelay) external onlyOwner {
        require(minDelay >= 10 seconds && minDelay <= 10 minutes, "BAD_DELAY");
        commitRevealEnabled = enabled;
        commitMinDelay = minDelay;
        emit CommitRevealUpdated(enabled, minDelay);
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
