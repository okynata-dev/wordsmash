// Protocol analytics: lifetime totals + 30-day daily activity. Charts are plain
// flex bars off theme tokens — no chart library needed at this size, and the page
// stays readable in both themes and at any width.
import { useQuery } from "@tanstack/react-query";
import type { Analytics, AnalyticsPoint } from "@shared/types";
import { api } from "../api";
import { Card, ErrorState, Skeleton } from "../components/ui";
import { ethLabel } from "../lib/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Stats() {
  useDocumentTitle("Stats");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["analytics"],
    queryFn: api.analytics,
    retry: 1,
    refetchInterval: 60_000,
  });

  return (
    <div className="mx-auto max-w-[960px]">
      <header className="fade-up mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Stats</h1>
        <p className="mt-1 text-sm text-muted">
          Everything below is indexed from the chain — the contracts are the source of truth.
        </p>
      </header>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : isError || !data ? (
        <ErrorState message="Couldn’t load analytics." onRetry={() => void refetch()} />
      ) : (
        <StatsBody data={data} />
      )}
    </div>
  );
}

function StatsBody({ data }: { data: Analytics }) {
  const t = data.totals;
  return (
    <div className="space-y-6">
      <div className="fade-up grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Words" value={t.words.toLocaleString("en-US")} />
        <Metric label="Markets" value={t.markets.toLocaleString("en-US")} />
        <Metric label="Trades" value={t.trades.toLocaleString("en-US")} />
        <Metric label="Traders" value={t.uniqueTraders.toLocaleString("en-US")} />
        <Metric label="Trade volume" value={ethLabel(t.tradeVolumeWei)} />
        <Metric label="Deed volume" value={ethLabel(t.deedVolumeWei)} />
      </div>

      <BarPanel
        title="Words kept per day"
        points={data.daily}
        value={(p) => p.claims}
        format={(v) => `${v} ${v === 1 ? "word" : "words"}`}
      />
      <BarPanel
        title="Trade volume per day"
        points={data.daily}
        value={(p) => weiToNum(p.volumeWei)}
        format={(v) => `${v.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`}
        sub={(p) => `${p.trades} ${p.trades === 1 ? "trade" : "trades"}`}
      />
    </div>
  );
}

function weiToNum(wei: string): number {
  try {
    return Number(BigInt(wei)) / 1e18;
  } catch {
    return 0;
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums" title={value}>
        {value}
      </p>
    </Card>
  );
}

function BarPanel({
  title,
  points,
  value,
  format,
  sub,
}: {
  title: string;
  points: AnalyticsPoint[];
  value: (p: AnalyticsPoint) => number;
  format: (v: number) => string;
  sub?: (p: AnalyticsPoint) => string;
}) {
  const max = Math.max(1e-12, ...points.map(value));
  return (
    <Card className="fade-up p-5" style={{ animationDelay: "60ms" }}>
      <h2 className="mb-4 text-sm font-medium text-muted">{title}</h2>
      {points.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">No activity yet.</p>
      ) : (
        <>
          <div className="flex h-36 items-end gap-1" role="img" aria-label={title}>
            {points.map((p) => {
              const v = value(p);
              const h = Math.max(v > 0 ? 4 : 1, Math.round((v / max) * 100));
              return (
                <div
                  key={p.day}
                  className="group relative flex-1 rounded-t-sm bg-[rgb(var(--c-volt))]/70 transition hover:bg-[rgb(var(--c-volt))]"
                  style={{ height: `${h}%` }}
                  title={`${p.day} — ${format(v)}${sub ? ` · ${sub(p)}` : ""}`}
                />
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[11px] tabular-nums text-faint">
            <span>{points[0].day}</span>
            <span>{points[points.length - 1].day}</span>
          </div>
        </>
      )}
    </Card>
  );
}
