import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { parseEther } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { normalizeWord } from "@shared/normalize";
import { api } from "../api";
import {
  marketplaceAddress,
  registryAddress,
  wordRegistryAbi,
  deedMarketplaceAbi,
  wordToTokenId,
} from "../contracts";
import { Button, Card, Pill, Spinner, ErrorState } from "../components/ui";
import { ShareButton } from "../components/ShareButton";
import { WhitelistGate } from "../components/WhitelistGate";
import { WatchButton } from "../components/WatchButton";
import { Comments } from "../components/Comments";
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
  // Always display the canonical form, never the raw URL param (e.g. /word/BREAD -> "bread").
  const display = detail?.word || normalizeWord(word).normalized || word.toLowerCase();
  useDocumentTitle(display);

  const owner = detail?.owner ?? null;
  const listing = detail?.listing ?? null;
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
            <p className="mt-3.5 max-w-[46ch] text-sm text-muted">
              The only <span className="font-medium text-fg">{display}</span> there will ever be.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {tokenId !== null && <WatchButton tokenId={tokenId.toString()} />}
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
          ) : isError ? (
            <Pill tone="warning">status unavailable</Pill>
          ) : (
            <Pill tone="positive">unclaimed</Pill>
          )}
          <Pill>1 of 1 · forever</Pill>
        </div>
      </Card>

      {isError && !detail ? (
        <div className="mt-5">
          <ErrorState message="Couldn’t load this word." onRetry={() => void refetch()} />
        </div>
      ) : null}

      {!owner && !isLoading && !isError && (
        <Card className="mt-5 p-5 text-center text-sm text-muted">
          No one owns “{display}” yet.{" "}
          <Link to="/" className="text-fg underline">
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
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
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

  return (
    <Card className="flex flex-col items-center gap-2 p-5">
      <Button
        className="w-full sm:w-auto"
        disabled={isPending || confirming || syncing || sellerBlocked || priceBad || loadingSeller}
        onClick={() => {
          if (priceWei === null) return;
          writeContract(
            {
              address: marketplaceAddress,
              abi: deedMarketplaceAbi,
              functionName: "buy",
              args: [tokenId],
              value: priceWei,
            },
            {
              onError: (e) => toast.error(friendlyError(e)),
              onSuccess: () => toast.info("Buying… confirm in your wallet"),
            },
          );
        }}
      >
        {isPending || confirming || syncing ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : "Buying…"}
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
  onDone,
}: {
  tokenId: bigint;
  listed: boolean;
  word: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const { address } = useAccount();
  const [priceInput, setPriceInput] = useState("");
  const { sync, syncing } = useSyncAfterTx();

  // Is the marketplace approved to move this token? (operator approval or per-token)
  const { data: approvedForAll, refetch: refetchApproval } = useReadContract({
    address: registryAddress,
    abi: wordRegistryAbi,
    functionName: "isApprovedForAll",
    args: address ? [address, marketplaceAddress] : undefined,
    query: { enabled: Boolean(address) },
  });

  const approve = useWriteContract();
  const list = useWriteContract();
  const cancel = useWriteContract();

  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });
  const listReceipt = useWaitForTransactionReceipt({ hash: list.data });
  const cancelReceipt = useWaitForTransactionReceipt({ hash: cancel.data });

  useEffect(() => {
    if (approveReceipt.isSuccess) {
      toast.success("Marketplace approved");
      void refetchApproval();
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

  const needsApproval = approvedForAll !== true;
  const priceInputId = "list-price-input";

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
          className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
        />
        {needsApproval ? (
          <Button
            disabled={approve.isPending || approveReceipt.isLoading}
            onClick={() =>
              approve.writeContract(
                {
                  address: registryAddress,
                  abi: wordRegistryAbi,
                  functionName: "setApprovalForAll",
                  args: [marketplaceAddress, true],
                },
                {
                  onError: (e) => toast.error(friendlyError(e)),
                  onSuccess: () => toast.info("Approving… confirm in your wallet"),
                },
              )
            }
          >
            {approve.isPending || approveReceipt.isLoading ? (
              <>
                <Spinner /> Approving…
              </>
            ) : (
              "Approve"
            )}
          </Button>
        ) : (
          <Button
            disabled={!parsedPrice || priceInvalid || list.isPending || listReceipt.isLoading || syncing}
            onClick={() =>
              parsedPrice &&
              list.writeContract(
                {
                  address: marketplaceAddress,
                  abi: deedMarketplaceAbi,
                  functionName: "list",
                  args: [tokenId, parsedPrice],
                },
                {
                  onError: (e) => toast.error(friendlyError(e)),
                  onSuccess: () => toast.info("Listing… confirm in your wallet"),
                },
              )
            }
          >
            {list.isPending || listReceipt.isLoading || syncing ? (
              <>
                <Spinner /> {syncing ? "Syncing…" : "Listing…"}
              </>
            ) : (
              "List"
            )}
          </Button>
        )}
      </div>
      {priceInvalid && <p className="text-xs text-negative">Enter a positive ETH amount.</p>}
      {needsApproval && (
        <p className="text-xs text-muted">
          One-time: approve the marketplace to transfer your word on sale.
        </p>
      )}
    </Card>
  );
}
