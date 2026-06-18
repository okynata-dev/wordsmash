import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { Card, Pill, Spinner, ErrorState } from "../ui";
import { UserBadge } from "../UserBadge";
import { ethLabel, tokenLabel, timeAgo } from "../../lib/format";

export function tradesKey(word: string) {
  return ["trades", word] as const;
}

/**
 * Recent token-market trades for a word. Reads the first page of GET
 * /word/:word/trades; auto-refreshes when a trade in the buy/sell box invalidates
 * the ["trades", word] key via useSyncAfterTx.
 */
export function RecentTrades({ word, symbol }: { word: string; symbol?: string | null }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: tradesKey(word),
    queryFn: () => api.trades(word),
    retry: 1,
  });

  const trades = data?.items ?? [];

  return (
    <section className="mt-12" aria-label="Recent trades">
      <h2 className="mb-3 text-sm font-medium text-muted">
        Recent trades {trades.length ? <span className="text-faint">· {trades.length}</span> : null}
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
        <Card className="divide-y divide-border">
          {trades.map((t, i) => (
            <div
              key={`${t.tx}-${i}`}
              className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
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
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}
