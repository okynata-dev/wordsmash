import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { UserBadge } from "./UserBadge";
import { Card, Pill, Spinner, ErrorState, Skeleton } from "./ui";
import { ethLabel, timeAgo } from "../lib/format";
import type { ActivityRow } from "@shared/types";

const verb: Record<ActivityRow["type"], string> = {
  claim: "claimed",
  list: "listed",
  cancel: "cancelled listing of",
  sale: "sold",
  transfer: "transferred",
  buy: "bought",
  sell: "sold tokens of",
};

const tone: Record<ActivityRow["type"], "muted" | "positive" | "negative" | "warning"> = {
  claim: "positive",
  list: "muted",
  cancel: "warning",
  sale: "positive",
  transfer: "muted",
  buy: "positive",
  sell: "negative",
};

/**
 * Platform-wide activity feed. Auto-refreshes. `limit` caps rows for the compact
 * home widget; omit it on the full /activity page.
 */
export function ActivityFeed({ limit, compact = false }: { limit?: number; compact?: boolean }) {
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["activity"],
    queryFn: api.activity,
    retry: 1,
    refetchInterval: 20_000,
  });

  if (isLoading) {
    return (
      <Card className="divide-y divide-border">
        {Array.from({ length: limit ?? 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="h-6 w-6 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        ))}
      </Card>
    );
  }

  if (isError) {
    return <ErrorState message="Couldn’t load activity." onRetry={() => void refetch()} />;
  }

  const rows = (Array.isArray(data) ? data : []).slice(0, limit);

  if (rows.length === 0) {
    return <Card className="p-5 text-sm text-muted">No activity yet.</Card>;
  }

  return (
    <Card className="divide-y divide-border">
      {compact && isFetching && (
        <div className="flex items-center gap-2 px-4 py-2 text-xs text-faint">
          <Spinner /> updating…
        </div>
      )}
      {rows.map((a, i) => (
        <div
          key={`${a.tx}-${i}`}
          className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"
        >
          <span className="flex min-w-0 items-center gap-2">
            <UserBadge address={a.address} size={22} />
            <span className="text-muted">{verb[a.type]}</span>
            <Link
              to={`/word/${encodeURIComponent(a.word)}`}
              className="font-medium text-fg hover:underline"
            >
              {a.word}
            </Link>
          </span>
          <span className="flex shrink-0 items-center gap-3">
            <Pill tone={tone[a.type]}>{a.type}</Pill>
            {a.price ? <span className="font-medium tabular-nums">{ethLabel(a.price)}</span> : null}
            <span className="text-xs text-faint">{timeAgo(a.ts)}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}
