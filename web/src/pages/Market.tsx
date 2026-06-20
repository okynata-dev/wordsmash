import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { marketplaceAddress, deedMarketplaceAbi } from "../contracts";
import { Button, Card, Spinner, ErrorState, Skeleton } from "../components/ui";
import { WhitelistGate } from "../components/WhitelistGate";
import { UserBadge } from "../components/UserBadge";
import { useToast } from "../components/Toast";
import { ethLabel, friendlyError, toWei, normAddr } from "../lib/format";
import {
  useWrongNetwork,
  useWhitelistEnabled,
  useIsWhitelisted,
} from "../hooks/useRegistry";
import { useSyncAfterTx } from "../hooks/useSyncAfterTx";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { ListingRow } from "@shared/types";

type Sort = "recent" | "price-asc" | "price-desc";

export function Market() {
  useDocumentTitle("Market");
  const [sort, setSort] = useState<Sort>("recent");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["market"],
    queryFn: api.market,
    retry: 1,
  });

  const listings = useMemo(() => {
    const items = (data ?? []).filter((l) => l.active);
    const sorted = [...items];
    // Guard every wei->bigint conversion: malformed prices sort to 0n, never throw.
    const w = (p: string) => toWei(p) ?? 0n;
    if (sort === "price-asc") sorted.sort((a, b) => cmp(w(a.price), w(b.price)));
    if (sort === "price-desc") sorted.sort((a, b) => cmp(w(b.price), w(a.price)));
    return sorted;
  }, [data, sort]);

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Marketplace</h1>
        <div className="flex items-center gap-1 text-sm">
          <SortTab active={sort === "recent"} onClick={() => setSort("recent")}>
            Recent
          </SortTab>
          <SortTab active={sort === "price-asc"} onClick={() => setSort("price-asc")}>
            Price ↑
          </SortTab>
          <SortTab active={sort === "price-desc"} onClick={() => setSort("price-desc")}>
            Price ↓
          </SortTab>
        </div>
      </header>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load the marketplace." onRetry={() => void refetch()} />
      ) : listings.length === 0 ? (
        <Card className="p-6 text-sm text-muted">No active listings right now.</Card>
      ) : (
        <div className="space-y-3">
          {listings.map((l) => (
            <ListingCard key={l.tokenId} listing={l} onDone={refetch} />
          ))}
        </div>
      )}
    </div>
  );
}

function ListingCard({ listing, onDone }: { listing: ListingRow; onDone: () => void }) {
  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();
  const toast = useToast();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { sync, syncing } = useSyncAfterTx();

  const { data: whitelistEnabled } = useWhitelistEnabled();
  const { data: sellerWhitelisted } = useIsWhitelisted(listing.seller as `0x${string}`);
  const sellerBlocked = whitelistEnabled === true && sellerWhitelisted === false;

  useEffect(() => {
    if (isSuccess) {
      toast.success("Purchased");
      void sync([["market"], ["stats"], ["activity"], ["word", listing.word]]).then(onDone);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const isSeller = normAddr(address) !== "" && normAddr(address) === normAddr(listing.seller);
  const priceWei = toWei(listing.price);
  const priceBad = priceWei === null;

  const tokenId = (() => {
    try {
      return BigInt(listing.tokenId);
    } catch {
      return null;
    }
  })();

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:border-fg/20">
      <Link to={`/word/${encodeURIComponent(listing.word)}`} className="min-w-0">
        <div className="word-display truncate text-2xl">{listing.word}</div>
        <div className="mt-1 text-xs text-muted">
          by <UserBadge address={listing.seller} size={18} link={false} />
        </div>
      </Link>
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-3">
          <span className="font-medium tabular-nums">{ethLabel(listing.price)}</span>
          {/* Buy is gated by the whitelist exactly like the word page (compact for the list). */}
          <WhitelistGate compact>
            <Button
              disabled={
                !isConnected ||
                wrongNetwork ||
                isSeller ||
                isPending ||
                confirming ||
                syncing ||
                isSuccess ||
                sellerBlocked ||
                priceBad ||
                tokenId === null
              }
              onClick={() => {
                if (tokenId === null || priceWei === null) return;
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
              {isSuccess ? (
                "Bought"
              ) : isPending || confirming || syncing ? (
                <>
                  <Spinner /> {syncing ? "Syncing…" : "Buying…"}
                </>
              ) : isSeller ? (
                "Your listing"
              ) : (
                "Buy"
              )}
            </Button>
          </WhitelistGate>
        </div>
        {sellerBlocked && !isSeller && (
          <p role="status" className="text-xs text-warning">
            Seller not whitelisted — can’t settle.
          </p>
        )}
      </div>
    </Card>
  );
}

function SortTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-md px-3 py-1.5 transition",
        active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function cmp(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
