import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Card, Pill, Spinner, ErrorState } from "../ui";
import { LiveBadge } from "../ActivityFeed";
import { UserBadge } from "../UserBadge";
import { ethLabel, tokenLabel, timeAgo } from "../../lib/format";
import type { TradeRow } from "@shared/types";

export function tradesKey(word: string) {
  return ["trades", word] as const;
}

// Content-based key so a prepended trade doesn't shift every row's key and re-animate
// the whole list each poll (index-based keys did exactly that).
function tradeKey(t: TradeRow): string {
  return `${t.tx}-${t.trader}-${t.ts}-${t.tokenAmount}`;
}

// Cap the dedup set so a long-lived coin page doesn't leak memory across polls.
const MAX_SEEN = 500;

/**
 * Recent token-market trades for a word. Reads the first page of GET
 * /word/:word/trades, polls fast for a live feel, and animates newly-arrived
 * trades in. Also auto-refreshes when the buy/sell box invalidates the
 * ["trades", word] key via useSyncAfterTx.
 */
export function RecentTrades({ word, symbol }: { word: string; symbol?: string | null }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: tradesKey(word),
    queryFn: () => api.trades(word),
    retry: 1,
    refetchInterval: 5_000,
  });

  const trades = data?.items ?? [];

  // Flag freshly-arrived trades so only they animate in (not the whole list).
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    if (!primed.current) {
      trades.forEach((t) => seen.current.add(tradeKey(t)));
      primed.current = true;
      return;
    }
    const fresh = new Set<string>();
    trades.forEach((t) => {
      const k = tradeKey(t);
      if (!seen.current.has(k)) {
        fresh.add(k);
        seen.current.add(k);
      }
    });
    if (fresh.size > 0) setFreshKeys(fresh);

    // Bound memory: keep only the most-recent keys (Sets iterate insertion-order,
    // so the leading entries are the oldest).
    if (seen.current.size > MAX_SEEN) {
      let toDrop = seen.current.size - MAX_SEEN;
      for (const k of seen.current) {
        seen.current.delete(k);
        if (--toDrop <= 0) break;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <section className="mt-12" aria-label="Recent trades">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
        Recent trades
        {trades.length ? <span className="text-faint">· {trades.length}</span> : null}
        <LiveBadge className="ml-1" />
      </h2>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading trades…
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load trades." onRetry={() => void refetch()} />
      ) : trades.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No trades yet. Be the first to buy.</Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          <ul aria-live="polite" className="divide-y divide-border">
            {trades.map((t) => {
              const k = tradeKey(t);
              return (
                <li
                  key={k}
                  className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${
                    freshKeys.has(k) ? "row-enter" : ""
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Pill tone={t.isBuy ? "positive" : "negative"}>{t.isBuy ? "buy" : "sell"}</Pill>
                    <UserBadge address={t.trader} size={20} textClassName="text-xs" />
                  </span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <span className="font-medium">{ethLabel(t.ethWei)}</span>
                    <span className="text-xs text-faint">{tokenLabel(t.tokenAmount, symbol)}</span>
                    <span className="text-xs text-faint">{timeAgo(t.ts)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </section>
  );
}
