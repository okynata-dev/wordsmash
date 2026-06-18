import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card, ErrorState, Skeleton } from "../components/ui";
import { UserBadge } from "../components/UserBadge";
import { ethLabel, normAddr } from "../lib/format";

export function Top() {
  const {
    data: stats,
    isError: statsError,
    refetch: refetchStats,
  } = useQuery({ queryKey: ["stats"], queryFn: api.stats, retry: 1 });

  const {
    data: wordsResult,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ["words", "volume"],
    // Follow the pagination cursor (up to a cap) so the leaderboard isn't silently
    // truncated to the first page.
    queryFn: () => api.words("volume"),
    retry: 1,
  });

  const words = wordsResult?.items ?? [];
  const truncated = wordsResult?.truncated ?? false;

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
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Leaderboard</h1>

      <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Mini label="Words" value={stats?.wordsClaimed} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Owners" value={stats?.uniqueOwners} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Sales" value={stats?.sales} error={statsError} onRetry={() => void refetchStats()} />
        <Mini label="Volume" suffix={stats ? ethLabel(stats.totalVolumeWei) : undefined} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, c) => (
            <Card key={c} className="divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-4 py-3">
                  <Skeleton className="h-5 w-40" />
                </div>
              ))}
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load the leaderboard." onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
              Most traded words
              {truncated && (
                <span className="text-xs text-faint" title="Showing a capped slice of all words">
                  · top results
                </span>
              )}
            </h2>
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
          </section>

          <section>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-muted">
              Top owners by holdings
              {truncated && (
                <span className="text-xs text-faint" title="Derived from a capped slice of all words">
                  · approx.
                </span>
              )}
            </h2>
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
      )}
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
