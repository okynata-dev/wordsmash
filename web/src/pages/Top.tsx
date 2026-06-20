import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { WordRow } from "@shared/types";
import { api } from "../api";
import { Card, ErrorState, Pill, Skeleton } from "../components/ui";
import { UserBadge } from "../components/UserBadge";
import { ethLabel, normAddr } from "../lib/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

/**
 * Optional per-word market fields the `sort=trading` endpoint may attach to a
 * WordRow. Kept local + optional so we read them when present without modifying
 * the shared WordRow type, and degrade cleanly when the API omits them.
 */
type TradedWordRow = WordRow & {
  priceWei?: string;
  marketCapWei?: string;
  tradingVolumeWei?: string;
};

// #, Word, Volume, Mkt cap — shared by the leaderboard header and rows.
const TOP_COLS = "grid-cols-[40px_1fr_minmax(80px,120px)_minmax(80px,120px)]";

export function Top() {
  useDocumentTitle("Top words");
  const {
    data: stats,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({ queryKey: ["stats"], queryFn: api.stats, retry: 1 });

  // Most-traded coins, ranked by token trading volume (v2).
  const {
    data: tradedResult,
    isLoading: tradedLoading,
    isError: tradedError,
    refetch: refetchTraded,
  } = useQuery({
    queryKey: ["words", "trading"],
    queryFn: () => api.words("trading"),
    retry: 1,
  });

  // Existing deed-sale volume ranking, kept as the owners source.
  const {
    data: wordsResult,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["words", "volume"],
    queryFn: () => api.words("volume"),
    retry: 1,
  });

  const traded = (tradedResult?.items ?? []) as TradedWordRow[];
  const tradedTruncated = tradedResult?.truncated ?? false;
  const words = wordsResult?.items ?? [];

  // Owners-by-holdings, derived from the words index. Key on the normalized
  // (lowercased) address so a single owner is never double-counted.
  const owners = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of words) {
      const key = normAddr(w.owner);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([address, count]) => ({ address, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }, [words]);

  return (
    <div className="mx-auto max-w-[920px]">
      <div className="fade-up mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Top words</h1>
        <p className="mt-2 text-sm text-muted">
          Ranked by token-market volume across the launchpad.
        </p>
      </div>

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Words" value={stats?.wordsClaimed} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Owners" value={stats?.uniqueOwners} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Sales" value={stats?.sales} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Volume" suffix={stats ? ethLabel(stats.totalVolumeWei) : undefined} />
      </div>

      {/* Most traded coins (v2 token markets) */}
      <section className="mb-10">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
          Most traded coins
          {tradedTruncated && (
            <span className="text-xs text-faint" title="Showing a capped slice">
              · top results
            </span>
          )}
        </h2>
        {tradedLoading ? (
          <Card className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="px-4 py-3">
                <Skeleton className="h-5 w-48" />
              </div>
            ))}
          </Card>
        ) : tradedError ? (
          <ErrorState message="Couldn’t load traded coins." onRetry={() => void refetchTraded()} />
        ) : traded.length === 0 ? (
          <Card className="px-4 py-6 text-sm text-muted">No traded coins yet.</Card>
        ) : (
          <Card className="fade-up overflow-hidden" style={{ animationDelay: "60ms" }}>
            <div className={`grid ${TOP_COLS} gap-3 border-b border-border px-4 py-2.5 text-[11px] uppercase tracking-wide text-faint`}>
              <span>#</span>
              <span>Word</span>
              <span className="text-right">Volume</span>
              <span className="text-right">Mkt cap</span>
            </div>
            {traded.slice(0, 20).map((w, i, arr) => {
              const vol = w.tradingVolumeWei ?? w.tradeVolumeWei;
              return (
                <Link
                  key={w.tokenId}
                  to={`/word/${encodeURIComponent(w.word)}`}
                  className={`grid ${TOP_COLS} items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 ${
                    i < arr.length - 1 ? "border-b border-border" : ""
                  }`}
                >
                  <span
                    className={`text-[15px] font-semibold tabular-nums ${
                      i === 0 ? "text-warning" : "text-faint"
                    }`}
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="word-display truncate text-lg">{w.word}</span>
                    {w.graduated && <Pill tone="warning">🎓</Pill>}
                  </span>
                  <span className="text-right font-semibold tabular-nums">
                    {vol ? ethLabel(vol) : "—"}
                  </span>
                  <span className="text-right tabular-nums text-muted">
                    {w.marketCapWei ? ethLabel(w.marketCapWei) : "—"}
                  </span>
                </Link>
              );
            })}
          </Card>
        )}
        <p className="mt-3 px-0.5 text-xs text-faint">
          Volume is gameable; unique-holder and unique-trader ranking is on the roadmap.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted">Most traded words (deed sales)</h2>
          {isError ? (
            <ErrorState message="Couldn’t load this list." onRetry={() => void refetch()} />
          ) : (
            <Card className="divide-y divide-border">
              {words.slice(0, 20).map((w, i) => (
                <Link
                  key={w.tokenId}
                  to={`/word/${encodeURIComponent(w.word)}`}
                  className="flex items-center justify-between px-4 py-3 transition hover:bg-surface-2"
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 text-xs text-faint tabular-nums">{i + 1}</span>
                    <span className="word-display text-lg">{w.word}</span>
                  </span>
                  <UserBadge address={w.owner} size={20} link={false} textClassName="text-xs" />
                </Link>
              ))}
              {words.length === 0 && (
                <div className="px-4 py-6 text-sm text-muted">No words yet.</div>
              )}
            </Card>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-medium text-muted">Top owners by holdings</h2>
          <Card className="divide-y divide-border">
            {owners.map((o, i) => (
              <Link
                key={o.address}
                to={`/profile/${o.address}`}
                className="flex items-center justify-between px-4 py-3 transition hover:bg-surface-2"
              >
                <span className="flex items-center gap-3">
                  <span className="w-5 text-xs text-faint tabular-nums">{i + 1}</span>
                  <UserBadge address={o.address} size={22} link={false} />
                </span>
                <span className="text-xs text-muted tabular-nums">{o.count} words</span>
              </Link>
            ))}
            {owners.length === 0 && (
              <div className="px-4 py-6 text-sm text-muted">No owners yet.</div>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  suffix,
  error,
  onRetry,
}: {
  label: string;
  value?: number;
  suffix?: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-4 text-center">
      <div className="text-xl font-semibold tabular-nums">
        {error ? (
          <button onClick={onRetry} className="text-sm font-normal text-muted underline">
            retry
          </button>
        ) : suffix !== undefined ? (
          suffix
        ) : value === undefined ? (
          "—"
        ) : (
          value.toLocaleString()
        )}
      </div>
      <div className="mt-1 text-xs text-muted">{label}</div>
    </Card>
  );
}
