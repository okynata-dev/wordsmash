// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWordRegistry {
    function isAllowed(address account) external view returns (bool);
}

/// @title DeedMarketplace
/// @notice Fixed-price marketplace for word deeds. Flat 10% protocol fee. Fully pull-payment:
///         buy() moves no ETH out — seller proceeds, buyer refunds, and protocol fees are all
///         credited and later withdrawn, so no external-call reentrancy can touch contract funds.
/// @dev    Closed-beta whitelist is the registry's single shared gate. list/buy require the actor to
///         be allowed; the deed transfer itself is independently gated inside the registry's
///         _update hook (both parties must be whitelisted), so resale stays whitelist-only.
contract DeedMarketplace is Ownable, ReentrancyGuard {
    uint256 public constant FEE_BPS = 1000; // 10%, flat
    uint256 internal constant BPS = 10_000;

    IERC721 public immutable deed; // the WordRegistry (ERC-721)
    IWordRegistry public immutable registry; // same address, gate view
    address public protocolFeeReceiver;

    struct Listing {
        address seller;
        uint256 price;
        bool active;
    }

    mapping(uint256 => Listing) public listings;
    mapping(address => uint256) public pendingWithdrawals; // pull: seller proceeds + buyer refunds
    uint256 public accruedFees;

    uint256[] private _everListedIds;
    mapping(uint256 => bool) private _everListed;

    event Listed(uint256 indexed tokenId, address indexed seller, uint256 price);
    event Cancelled(uint256 indexed tokenId, address indexed seller);
    event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee);
    event Withdrawal(address indexed to, uint256 amount);
    event FeesWithdrawn(address indexed to, uint256 amount);

    constructor(address registry_, address protocolFeeReceiver_) Ownable(msg.sender) {
        require(registry_ != address(0) && protocolFeeReceiver_ != address(0), "ZERO_ADDR");
        deed = IERC721(registry_);
        registry = IWordRegistry(registry_);
        protocolFeeReceiver = protocolFeeReceiver_;
    }

    /// @notice List a deed you own. Requires marketplace approval and whitelist (during beta).
    function list(uint256 tokenId, uint256 price) external {
        require(registry.isAllowed(msg.sender), "NOT_WHITELISTED");
        require(price > 0, "ZERO_PRICE");
        require(deed.ownerOf(tokenId) == msg.sender, "NOT_OWNER");
        require(
            deed.getApproved(tokenId) == address(this) || deed.isApprovedForAll(msg.sender, address(this)),
            "NOT_APPROVED"
        );
        listings[tokenId] = Listing({seller: msg.sender, price: price, active: true});
        if (!_everListed[tokenId]) {
            _everListed[tokenId] = true;
            _everListedIds.push(tokenId);
        }
        emit Listed(tokenId, msg.sender, price);
    }

    function cancel(uint256 tokenId) external {
        Listing storage l = listings[tokenId];
        require(l.active, "NOT_LISTED");
        require(l.seller == msg.sender, "NOT_SELLER");
        l.active = false;
        emit Cancelled(tokenId, msg.sender);
    }

    /// @notice Buy a listed deed. Credits seller/buyer/protocol (pull), then transfers the deed.
    function buy(uint256 tokenId) external payable nonReentrant {
        require(registry.isAllowed(msg.sender), "NOT_WHITELISTED");
        Listing memory l = listings[tokenId];
        require(l.active, "NOT_LISTED");
        require(deed.ownerOf(tokenId) == l.seller, "SELLER_MOVED_DEED");
        require(msg.value >= l.price, "INSUFFICIENT_PAYMENT");

        // Effects first: deactivate + credit everyone (no ETH leaves here).
        listings[tokenId].active = false;
        uint256 fee = (l.price * FEE_BPS) / BPS;
        uint256 proceeds = l.price - fee;
        accruedFees += fee;
        pendingWithdrawals[l.seller] += proceeds;
        uint256 excess = msg.value - l.price;
        if (excess > 0) pendingWithdrawals[msg.sender] += excess;

        // Interaction: transfer the deed. This is also whitelist-gated in the registry.
        deed.safeTransferFrom(l.seller, msg.sender, tokenId);

        emit Sale(tokenId, l.seller, msg.sender, l.price, fee);
    }

    /// @notice Pull your credited balance (sale proceeds and/or refunds).
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "NOTHING");
        pendingWithdrawals[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "WITHDRAW_FAIL");
        emit Withdrawal(msg.sender, amount);
    }

    /// @notice Pull accrued protocol fees to the receiver.
    function withdrawFees() external nonReentrant {
        require(msg.sender == owner() || msg.sender == protocolFeeReceiver, "NOT_AUTHORIZED");
        uint256 amount = accruedFees;
        require(amount > 0, "NOTHING");
        accruedFees = 0;
        (bool ok,) = protocolFeeReceiver.call{value: amount}("");
        require(ok, "WITHDRAW_FAIL");
        emit FeesWithdrawn(protocolFeeReceiver, amount);
    }

    function setProtocolFeeReceiver(address receiver) external onlyOwner {
        require(receiver != address(0), "ZERO_ADDR");
        protocolFeeReceiver = receiver;
    }

    // --- views for browse / marketplace ---

    function totalEverListed() external view returns (uint256) {
        return _everListedIds.length;
    }

    function activeListingsPage(uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids, address[] memory sellers, uint256[] memory prices)
    {
        uint256 total = _everListedIds.length;
        if (offset >= total) return (new uint256[](0), new address[](0), new uint256[](0));
        uint256 end = offset + limit;
        if (end > total) end = total;

        uint256 count = 0;
        for (uint256 i = offset; i < end; i++) {
            if (listings[_everListedIds[i]].active) count++;
        }
        ids = new uint256[](count);
        sellers = new address[](count);
        prices = new uint256[](count);
        uint256 j = 0;
        for (uint256 i = offset; i < end; i++) {
            uint256 id = _everListedIds[i];
            if (listings[id].active) {
                ids[j] = id;
                sellers[j] = listings[id].seller;
                prices[j] = listings[id].price;
                j++;
            }
        }
    }
}
