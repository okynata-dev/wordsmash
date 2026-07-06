// Token positions for a profile. The indexer nominates every market the address
// has traded on; the balances and values shown come from LIVE on-chain reads
// (balanceOf + currentPrice per market), so the numbers are always the truth.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { api } from "../api";
import { wordMarketAbi } from "../contracts";
import { asMarketAddress } from "../hooks/useMarket";
import { ADDRESSES_READY } from "../config";
import { Card, Skeleton } from "./ui";
import { ethLabel, tokenLabel } from "../lib/format";

export function Positions({ address }: { address: string }) {
  const candidates = useQuery({
    queryKey: ["positions", address.toLowerCase()],
    queryFn: () => api.positions(address),
    retry: 1,
    refetchInterval: 30_000,
  });

  const markets = useMemo(
    () =>
      (candidates.data ?? [])
        .map((p) => ({ ...p, addr: asMarketAddress(p.market) }))
        .filter((p): p is typeof p & { addr: Address } => Boolean(p.addr)),
    [candidates.data],
  );

  // Two live reads per market: the wallet's balance and the spot price.
  const reads = useReadContracts({
    allowFailure: true,
    contracts: markets.flatMap((m) => [
      {
        address: m.addr,
        abi: wordMarketAbi,
        functionName: "balanceOf" as const,
        args: [address as Address] as const,
      },
      { address: m.addr, abi: wordMarketAbi, functionName: "currentPrice" as const },
    ]),
    query: { enabled: ADDRESSES_READY && markets.length > 0, refetchInterval: 30_000 },
  });

  const rows = useMemo(() => {
    const val = (i: number): bigint =>
      reads.data?.[i]?.status === "success" ? (reads.data[i].result as bigint) : 0n;
    const toBig = (s: string) => {
      try {
        return BigInt(s);
      } catch {
        return 0n;
      }
    };
    return markets
      .map((m, i) => {
        const balance = val(2 * i);
        const price = val(2 * i + 1);
        const valueWei = (balance * price) / 10n ** 18n;
        const costWei = toBig(m.costWei);
        // Unrealized P&L against the remaining cost basis. Null when there's no
        // basis to compare (fully-realized or never-bought-on-curve position).
        const pnlWei = costWei > 0n ? valueWei - costWei : null;
        const pnlPct = costWei > 0n ? (Number(valueWei - costWei) / Number(costWei)) * 100 : null;
        return { ...m, balance, valueWei, costWei, pnlWei, pnlPct };
      })
      .filter((r) => r.balance > 0n)
      .sort((a, b) => (a.valueWei > b.valueWei ? -1 : a.valueWei < b.valueWei ? 1 : 0));
  }, [markets, reads.data]);

  const totalWei = rows.reduce((a, r) => a + r.valueWei, 0n);
  const totalCost = rows.reduce((a, r) => a + r.costWei, 0n);
  const totalPnl = totalCost > 0n ? totalWei - totalCost : null;

  if (candidates.isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (rows.length === 0) {
    return <Card className="p-5 text-sm text-muted">No token positions.</Card>;
  }

  return (
    <Card className="divide-y divide-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
        <span className="text-muted">Total value (mark-to-market)</span>
        <span className="flex items-center gap-3">
          {totalPnl !== null && <PnlBadge wei={totalPnl} />}
          <span className="font-semibold tabular-nums">{ethLabel(totalWei)}</span>
        </span>
      </div>
      {/* header row */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 text-[11px] uppercase tracking-wide text-faint">
        <span>Word</span>
        <span className="flex shrink-0 items-center gap-4">
          <span className="w-24 text-right">Value</span>
          <span className="w-20 text-right">P&amp;L</span>
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.market} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <Link
            to={`/word/${encodeURIComponent(r.word)}`}
            className="min-w-0 flex-1 truncate font-medium hover:underline"
          >
            {r.word}
            <span className="ml-2 text-xs font-normal text-faint">
              {tokenLabel(r.balance, r.tokenSymbol)}
            </span>
          </Link>
          <span className="flex shrink-0 items-center gap-4 text-right">
            <span className="w-24 font-medium tabular-nums">{ethLabel(r.valueWei)}</span>
            <span className="w-20 text-right">
              {r.pnlPct !== null ? (
                <span
                  className={`text-xs font-medium tabular-nums ${
                    r.pnlPct >= 0 ? "text-positive" : "text-negative"
                  }`}
                  title={r.pnlWei !== null ? `${ethLabel(r.pnlWei)} vs cost` : undefined}
                >
                  {r.pnlPct >= 0 ? "+" : ""}
                  {r.pnlPct.toFixed(1)}%
                </span>
              ) : (
                <span className="text-xs text-faint">—</span>
              )}
            </span>
          </span>
        </div>
      ))}
    </Card>
  );
}

/** Signed ETH delta pill for the header total (green up / red down). */
function PnlBadge({ wei }: { wei: bigint }) {
  const up = wei >= 0n;
  return (
    <span
      className={`text-xs font-medium tabular-nums ${up ? "text-positive" : "text-negative"}`}
      title="Unrealized profit/loss vs. cost basis"
    >
      {up ? "+" : "−"}
      {ethLabel(wei < 0n ? -wei : wei)}
    </span>
  );
}
