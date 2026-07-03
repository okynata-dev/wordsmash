import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { parseEther, type Address } from "viem";
import {
  useAccount,
  useConfig,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { readContract } from "wagmi/actions";
import { useQuery } from "@tanstack/react-query";
import { normalizeWord } from "@shared/normalize";
import { api } from "../api";
import {
  marketplaceAddress,
  registryAddress,
  wordRegistryAbi,
  deedMarketplaceAbi,
  wordMarketAbi,
  wordToTokenId,
} from "../contracts";
import { activeChain } from "../wagmi";
import { asMarketAddress } from "../hooks/useMarket";
import { useReceiptError } from "../hooks/useReceiptError";
import { Button, Card, Pill, Spinner, ErrorState } from "../components/ui";
import { WalletButton } from "../components/WalletButton";
import { ShareButton } from "../components/ShareButton";
import { WhitelistGate } from "../components/WhitelistGate";
import { WatchButton } from "../components/WatchButton";
import { Comments } from "../components/Comments";
import { demoHasWord } from "../demo";
import { WordMarketPanel } from "../components/market/WordMarketPanel";
import { UserBadge } from "../components/UserBadge";
import { useToast } from "../components/Toast";
import { ethLabel, friendlyError, toWei, timeAgo, normAddr } from "../lib/format";
import {
  useWrongNetwork,
  useWhitelistEnabled,
  useIsAllowed,
  useIsWhitelisted,
} from "../hooks/useRegistry";
import { useSyncAfterTx } from "../hooks/useSyncAfterTx";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Word() {
  const { word = "" } = useParams();
  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();

  const {
    data: detail,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["word", word],
    queryFn: () => api.word(word),
    retry: 1,
  });

  const tokenId = wordToTokenId(word);
  // A URL like /word/привет or /word/has!chars can never be claimed on-chain —
  // don't show it as "unclaimed" with a Claim link that dead-ends.
  const invalidWord = !normalizeWord(word).ok && !detail?.owner;
  // Always display the canonical form, never the raw URL param (e.g. /word/BREAD -> "bread").
  const display = detail?.word || normalizeWord(word).normalized || word.toLowerCase();
  useDocumentTitle(display);

  const owner = detail?.owner ?? null;
  const listing = detail?.listing ?? null;
  // Demo words are registered-only (no on-chain deed/market). Suppress every on-chain
  // action surface for them so the illusion never offers a buy/list/watch that can't work.
  const isDemo = Boolean(detail) && detail?.market == null && demoHasWord(word);
  const isOwner =
    Boolean(address) && Boolean(owner) && normAddr(address) === normAddr(owner);

  // A connected + whitelisted (or whitelist-off) wallet may comment.
  const { data: whitelistEnabled } = useWhitelistEnabled();
  const { data: allowed } = useIsAllowed(address);
  const canPost = isConnected && !wrongNetwork && (whitelistEnabled === false || allowed === true);

  return (
    <div>
      <Link
        to="/market"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Market
      </Link>

      {/* Hero */}
      <Card className="fade-up p-6 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="word-display text-5xl leading-none sm:text-6xl">{display}</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Watch only claimed words — the indexer joins watchlist rows against
                `words`, so watching an unclaimed word "succeeds" but never shows up. */}
            {tokenId !== null && !isDemo && Boolean(owner) && (
              <WatchButton tokenId={tokenId.toString()} />
            )}
            <ShareButton word={display} variant="ghost" />
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-sm">
          {isLoading ? (
            <Pill>loading…</Pill>
          ) : owner ? (
            <span className="flex items-center gap-2 text-muted">
              <span className="text-xs text-faint">deed holder</span>
              <UserBadge address={owner} size={22} />
            </span>
          ) : invalidWord ? (
            <Pill tone="warning">not a valid word</Pill>
          ) : isError ? (
            <Pill tone="warning">status unavailable</Pill>
          ) : (
            <Pill tone="positive">unclaimed</Pill>
          )}
        </div>
      </Card>

      {/* Invalid words get the explanation card below, not a futile Retry. */}
      {isError && !detail && !invalidWord ? (
        <div className="mt-5">
          <ErrorState message="Couldn’t load this word." onRetry={() => void refetch()} />
        </div>
      ) : null}

      {invalidWord && !isLoading && (
        <Card className="mt-5 p-5 text-center text-sm text-muted">
          “{display}” can’t be kept — words are 1–30 characters, letters a–z and digits only.
        </Card>
      )}


      {!owner && !invalidWord && !isLoading && !isError && (
        <Card className="mt-5 p-5 text-center text-sm text-muted">
          No one owns “{display}” yet.{" "}
          <Link to={`/?claim=${encodeURIComponent(word)}`} className="text-fg underline">
            Claim it
          </Link>
          .
        </Card>
      )}

      {/* Token market (v2): the coin/trading view leads — it's the main event. */}
      {owner && detail?.market && (
        <div className="mt-5">
          <WordMarketPanel word={word} info={detail.market} onChanged={refetch} />
        </div>
      )}

      {/* Deed marketplace — buy/sell the 1-of-1 word deed (the NFT itself). */}
      {owner &&
        tokenId !== null &&
        !isDemo &&
        ((isConnected && !wrongNetwork) || listing?.active) && (
          <section className="mt-12 max-w-xl">
            <h2 className="mb-3 text-sm font-medium text-muted">Deed marketplace</h2>
            <div className="space-y-4">
              {isConnected && !wrongNetwork && (
                <WhitelistGate>
                  {isOwner ? (
                    <OwnerControls
                      tokenId={tokenId}
                      listed={Boolean(listing?.active)}
                      word={word}
                      marketAddr={asMarketAddress(detail?.market?.market)}
                      onDone={refetch}
                    />
                  ) : listing?.active ? (
                    <BuyControl
                      tokenId={tokenId}
                      price={listing.price}
                      seller={listing.seller}
                      word={word}
                      onDone={refetch}
                    />
                  ) : (
                    <Card className="p-5 text-center text-sm text-muted">
                      Not currently for sale.
                    </Card>
                  )}
                </WhitelistGate>
              )}
              {/* Active listing but no usable wallet: a way in, not a dead end. */}
              {listing?.active && (!isConnected || wrongNetwork) && (
                <Card className="flex flex-col items-center gap-3 p-5 text-sm text-muted">
                  <span>
                    {wrongNetwork ? "Switch network to buy it." : "Sign in to buy it."}
                  </span>
                  <WalletButton />
                </Card>
              )}
              {listing?.active && (
                <p className="flex flex-wrap items-center gap-1 text-sm text-muted">
                  Listed for{" "}
                  <span className="font-medium text-fg">{ethLabel(listing.price)}</span> by{" "}
                  <UserBadge address={listing.seller} size={20} />
                </p>
              )}
            </div>
          </section>
        )}

      {/* Ownership history */}
      {detail && detail.history.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-3 text-sm font-medium text-muted">Ownership history</h2>
          <Card className="divide-y divide-border">
            {detail.history.map((s, i) => (
              <div
                key={`${s.tokenId}-${s.ts}-${i}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
              >
                <span className="flex items-center gap-2 text-muted">
                  <UserBadge address={s.from} size={20} /> →{" "}
                  <UserBadge address={s.to} size={20} />
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-medium">{ethLabel(s.price)}</span>
                  <span className="text-xs text-faint">{timeAgo(s.ts)}</span>
                </span>
              </div>
            ))}
          </Card>
        </section>
      )}

      {/* Comments — pass the CANONICAL word (not the raw URL param), so the signed comment
          message matches what the indexer rebuilds after normalizing (e.g. /word/BREAD). */}
      <Comments word={display} canPost={canPost} />
    </div>
  );
}

function BuyControl({
  tokenId,
  price,
  seller,
  word,
  onDone,
}: {
  tokenId: bigint;
  price: string;
  seller: string;
  word: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const config = useConfig();
  const [checking, setChecking] = useState(false);
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const { isLoading: confirming, isSuccess } = receipt;
  useReceiptError(receipt, "The purchase");
  const { sync, syncing } = useSyncAfterTx();

  // Both parties must be whitelisted for the transfer to succeed.
  const { data: whitelistEnabled } = useWhitelistEnabled();
  const { data: sellerWhitelisted, isLoading: loadingSeller } = useIsWhitelisted(
    seller as `0x${string}`,
  );
  const sellerBlocked = whitelistEnabled === true && sellerWhitelisted === false;

  useEffect(() => {
    if (isSuccess) {
      toast.success("Purchased");
      void sync([
        ["word", word],
        ["market"],
        ["stats"],
        ["activity"],
      ]).then(onDone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const priceWei = toWei(price);
  const priceBad = priceWei === null || priceWei < 0n;

  // The contract accepts msg.value >= price and credits the excess to a pull
  // balance — so a buy must never send a stale (indexer-snapshot) price. Read the
  // live listing at click time: pay exactly it, and bail if it moved on the user.
  async function buyNow() {
    if (priceWei === null) return;
    setChecking(true);
    let live: readonly [string, bigint, boolean];
    try {
      live = (await readContract(config, {
        address: marketplaceAddress,
        abi: deedMarketplaceAbi,
        functionName: "listings",
        args: [tokenId],
        chainId: activeChain.id,
      })) as readonly [string, bigint, boolean];
    } catch {
      setChecking(false);
      toast.error("Couldn’t verify the listing — try again.");
      return;
    }
    setChecking(false);
    const [, livePrice, active] = live;
    if (!active) {
      toast.error("This listing is no longer active.");
      onDone();
      return;
    }
    if (livePrice !== priceWei) {
      toast.error(`The price changed to ${ethLabel(livePrice)} — review before buying.`);
      onDone();
      return;
    }
    writeContract(
      {
        address: marketplaceAddress,
        abi: deedMarketplaceAbi,
        functionName: "buy",
        // expectedPrice: the contract now re-checks the price WE saw — a seller
        // repricing after this read makes the tx revert instead of clearing.
        args: [tokenId, livePrice],
        value: livePrice,
        chainId: activeChain.id,
      },
      {
        onError: (e) => toast.error(friendlyError(e)),
        onSuccess: () => toast.info("Buying… confirm in your wallet"),
      },
    );
  }

  return (
    <Card className="flex flex-col items-center gap-2 p-5">
      <Button
        className="w-full sm:w-auto"
        disabled={
          isPending || confirming || syncing || checking || sellerBlocked || priceBad || loadingSeller
        }
        onClick={() => void buyNow()}
      >
        {isPending || confirming || syncing || checking ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : checking ? "Checking price…" : "Buying…"}
          </>
        ) : (
          `Buy · ${ethLabel(price)}`
        )}
      </Button>
      {sellerBlocked && (
        <p role="status" className="text-center text-xs text-warning">
          The seller isn’t whitelisted, so this sale can’t settle right now.
        </p>
      )}
      {priceBad && (
        <p role="status" className="text-center text-xs text-negative">
          This listing has an invalid price.
        </p>
      )}
    </Card>
  );
}

function OwnerControls({
  tokenId,
  listed,
  word,
  marketAddr,
  onDone,
}: {
  tokenId: bigint;
  listed: boolean;
  word: string;
  marketAddr?: Address;
  onDone: () => void;
}) {
  const toast = useToast();
  const { address } = useAccount();
  const [priceInput, setPriceInput] = useState("");
  const { sync, syncing } = useSyncAfterTx();

  // Unclaimed curve fees follow the DEED, not the seller: sell the word without
  // claiming and the buyer inherits the accrued pot. Warn before any listing.
  const { data: accruedFees } = useReadContract({
    address: marketAddr,
    abi: wordMarketAbi,
    functionName: "deedFeesAccrued",
    query: { enabled: Boolean(marketAddr), refetchInterval: 30_000 },
  });
  const unclaimedWei = (accruedFees as bigint | undefined) ?? 0n;

  // The marketplace takes a cut of the sale price (FEE_BPS, live-read like the
  // claim fee) — the seller must see their NET proceeds before listing.
  const { data: saleFeeBps } = useReadContract({
    address: marketplaceAddress,
    abi: deedMarketplaceAbi,
    functionName: "FEE_BPS",
  });
  const feeBps = (saleFeeBps as bigint | undefined) ?? null;

  // Is the marketplace approved to move THIS one token? We deliberately use per-token
  // approval (approve(tokenId)) rather than setApprovalForAll: listing one word must
  // never grant the marketplace access to the seller's OTHER words. list() accepts a
  // per-token approval, and it survives until the deed sells, so buy() still works.
  const { data: approvedAddr, refetch: refetchApproval } = useReadContract({
    address: registryAddress,
    abi: wordRegistryAbi,
    functionName: "getApproved",
    args: [tokenId],
    query: { enabled: Boolean(address) },
  });

  const approve = useWriteContract();
  const list = useWriteContract();
  const cancel = useWriteContract();

  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const listReceipt = useWaitForTransactionReceipt({ hash: list.data });
  const cancelReceipt = useWaitForTransactionReceipt({ hash: cancel.data });
  useReceiptError(approveReceipt, "The approval");
  useReceiptError(listReceipt, "The listing");
  useReceiptError(cancelReceipt, "The cancel");

  // One-tap listing: approve (per-token) and list are chained so the user can't
  // approve and then forget to actually list. The stash carries the tokenId it was
  // created for — the continue-effect must never list a DIFFERENT word (the route
  // is remounted per word, but this guard must not depend on that).
  const pendingListRef = useRef<{ tokenId: bigint; price: bigint } | null>(null);
  useEffect(() => {
    return () => {
      pendingListRef.current = null; // never carry a stash across unmount
    };
  }, []);

  function listNow(price: bigint) {
    list.writeContract(
      {
        address: marketplaceAddress,
        abi: deedMarketplaceAbi,
        functionName: "list",
        args: [tokenId, price],
        chainId: activeChain.id,
      },
      {
        onError: (e) => toast.error(friendlyError(e)),
        onSuccess: () => toast.info("Listing… confirm in your wallet"),
      },
    );
  }

  function submitListing(price: bigint) {
    if (needsApproval) {
      pendingListRef.current = { tokenId, price }; // list automatically once approval confirms
      approve.writeContract(
        {
          address: registryAddress,
          abi: wordRegistryAbi,
          functionName: "approve",
          args: [marketplaceAddress, tokenId],
          chainId: activeChain.id,
        },
        {
          onError: (e) => {
            pendingListRef.current = null;
            toast.error(friendlyError(e));
          },
          onSuccess: () => toast.info("Approving… confirm in your wallet"),
        },
      );
    } else {
      listNow(price);
    }
  }

  useEffect(() => {
    if (approveReceipt.isSuccess) {
      void refetchApproval();
      const pending = pendingListRef.current;
      pendingListRef.current = null;
      if (pending !== null && pending.tokenId === tokenId) {
        listNow(pending.price); // approval done -> immediately continue to the listing tx
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess]);

  useEffect(() => {
    if (listReceipt.isSuccess) {
      toast.success("Listed");
      setPriceInput("");
      void sync([["word", word], ["market"], ["activity"], ["stats"]]).then(onDone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listReceipt.isSuccess]);

  useEffect(() => {
    if (cancelReceipt.isSuccess) {
      toast.success("Listing cancelled");
      void sync([["word", word], ["market"], ["activity"], ["stats"]]).then(onDone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelReceipt.isSuccess]);

  if (listed) {
    return (
      <Card className="flex flex-col items-center gap-2 p-5">
        <p className="text-sm text-muted">You have this word listed for sale.</p>
        {unclaimedWei > 0n && (
          <p className="text-center text-xs text-warning">
            You have {ethLabel(unclaimedWei)} of unclaimed trade fees. Claim them (in the
            market panel above) before this sells — they go with the deed to the buyer.
          </p>
        )}
        <Button
          variant="danger"
          disabled={cancel.isPending || cancelReceipt.isLoading || syncing}
          onClick={() =>
            cancel.writeContract(
              {
                address: marketplaceAddress,
                abi: deedMarketplaceAbi,
                functionName: "cancel",
                args: [tokenId],
                chainId: activeChain.id,
              },
              { onError: (e) => toast.error(friendlyError(e)) },
            )
          }
        >
          {cancel.isPending || cancelReceipt.isLoading || syncing ? (
            <>
              <Spinner /> {syncing ? "Syncing…" : "Cancelling…"}
            </>
          ) : (
            "Cancel listing"
          )}
        </Button>
      </Card>
    );
  }

  let parsedPrice: bigint | null = null;
  try {
    parsedPrice = priceInput.trim() ? parseEther(priceInput.trim()) : null;
  } catch {
    parsedPrice = null;
  }
  const priceInvalid = priceInput.trim() !== "" && (parsedPrice === null || parsedPrice <= 0n);

  // undefined = the approval read hasn't answered yet. Block submission until it
  // has: treating "loading" as "needs approval" would fire a redundant approve tx
  // (silently signed on the embedded wallet).
  const approvalKnown = approvedAddr !== undefined;
  const needsApproval =
    (approvedAddr as string | undefined)?.toLowerCase() !== marketplaceAddress.toLowerCase();
  const priceInputId = "list-price-input";
  const approving = approve.isPending || approveReceipt.isLoading;
  const listingBusy = list.isPending || listReceipt.isLoading || syncing;
  const busy = approving || listingBusy;

  return (
    <Card className="space-y-3 p-5">
      <label htmlFor={priceInputId} className="text-sm font-medium">
        List this word for sale
      </label>
      <div className="flex gap-2">
        <input
          id={priceInputId}
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          inputMode="decimal"
          placeholder="price in ETH"
          aria-label="List price in ETH"
          aria-invalid={priceInvalid}
          disabled={busy /* the chained list uses the price captured at click — editing mid-chain must not look like it counts */}
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40 disabled:opacity-60"
        />
        <Button
          disabled={!parsedPrice || priceInvalid || busy || !approvalKnown}
          onClick={() => parsedPrice && submitListing(parsedPrice)}
        >
          {approving ? (
            <>
              <Spinner /> Approving…
            </>
          ) : listingBusy ? (
            <>
              <Spinner /> {syncing ? "Syncing…" : "Listing…"}
            </>
          ) : (
            "List for sale"
          )}
        </Button>
      </div>
      {priceInvalid && <p className="text-xs text-negative">Enter a positive ETH amount.</p>}
      {feeBps !== null && parsedPrice !== null && parsedPrice > 0n && !priceInvalid && (
        <p className="text-xs text-muted">
          Marketplace fee {(Number(feeBps) / 100).toFixed(0)}% — if it sells at this price,
          you&rsquo;ll receive{" "}
          <span className="font-medium text-fg">
            {ethLabel((parsedPrice * (10_000n - feeBps)) / 10_000n)}
          </span>
          .
        </p>
      )}
      {unclaimedWei > 0n && (
        <p className="text-xs text-warning">
          You have {ethLabel(unclaimedWei)} of unclaimed trade fees. Claim them (in the
          market panel above) before selling — they go with the deed to the buyer.
        </p>
      )}
      {approvalKnown && needsApproval && (
        <p className="text-xs text-muted">
          First listing approves the marketplace for just this one word — it can&apos;t
          touch your other words. Two quick confirmations, then it&apos;s live.
        </p>
      )}
    </Card>
  );
}
