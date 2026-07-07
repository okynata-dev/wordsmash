import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { UserBadge } from "./UserBadge";
import { Card, Pill, ErrorState, Skeleton } from "./ui";
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

// Content key: a single tx can emit several activity rows for the same token
// (e.g. two transfers to different counterparties), so tx+type+tokenId alone
// collides. Include counterparty + ts to keep keys unique without falling back
// to array index (which would re-animate the whole live list on each poll).
function rowKey(a: ActivityRow): string {
  return `${a.tx}-${a.type}-${a.tokenId}-${a.counterparty ?? ""}-${a.ts}`;
}

/**
 * Platform-wide activity feed. Auto-refreshes; when `live` it polls fast (~4s)
 * and animates newly-arrived rows in with a slide + highlight-fade. `limit` caps
 * rows for the compact home widget; omit it on the full /activity page.
 */
export function ActivityFeed({
  limit,
  compact = false,
  live = false,
  types,
}: {
  limit?: number;
  compact?: boolean;
  live?: boolean;
  /** Client-side type filter (e.g. ["buy","sell"]); omit for everything. */
  types?: readonly string[];
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["activity"],
    queryFn: api.activity,
    retry: 1,
    refetchInterval: live ? 4_000 : 20_000,
  });

  // Track which row keys we've already shown so only genuinely new rows animate.
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const [freshKeys, setFreshKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const rows = Array.isArray(data) ? data : [];
    if (!primed.current) {
      // First successful load: mark everything as seen so we don't flash the
      // whole list in on mount.
      for (const a of rows) seen.current.add(rowKey(a));
      primed.current = true;
      return;
    }
    const fresh = new Set<string>();
    for (const a of rows) {
      const k = rowKey(a);
      if (!seen.current.has(k)) {
        fresh.add(k);
        seen.current.add(k);
      }
    }
    if (fresh.size > 0) setFreshKeys(fresh);
  }, [data]);

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

  const all = Array.isArray(data) ? data : [];
  const rows = (types ? all.filter((a) => types.includes(a.type)) : all).slice(0, limit);

  if (rows.length === 0) {
    return (
      <Card className="p-5 text-sm text-muted">
        {types ? "Nothing in this category yet." : "No activity yet."}
      </Card>
    );
  }

  return (
    <Card className="divide-y divide-border overflow-hidden">
      <ul aria-label="Recent activity" aria-live="polite" className="divide-y divide-border">
        {rows.map((a) => {
          const k = rowKey(a);
          const fresh = freshKeys.has(k);
          return (
            <li
              key={k}
              className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${
                fresh ? "row-enter" : ""
              }`}
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
                {a.price ? (
                  <span className="font-medium tabular-nums">{ethLabel(a.price)}</span>
                ) : null}
                <span className="text-xs text-faint">{timeAgo(a.ts)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      {compact && <span className="sr-only">Live feed, updates automatically.</span>}
    </Card>
  );
}

/** Small pulsing "● LIVE" badge for live sections. */
export function LiveBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-positive ${className}`}
    >
      <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
      <span>LIVE</span>
    </span>
  );
}
