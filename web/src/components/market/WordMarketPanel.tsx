import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount, useReadContract } from "wagmi";
import type { MarketInfo } from "@shared/types";
import { api } from "../../api";
import { registryAddress, wordRegistryAbi, wordToTokenId } from "../../contracts";
import { ADDRESSES_READY } from "../../config";
import { Card, Pill, Skeleton } from "../ui";
import { WhitelistGate } from "../WhitelistGate";
import { WalletButton } from "../WalletButton";
import { ethLabel, tokenLabel, normAddr, toWei } from "../../lib/format";
import { useWrongNetwork } from "../../hooks/useRegistry";
import { asMarketAddress, useMarketReads, useTokenBalance } from "../../hooks/useMarket";
import { TradeBox } from "./TradeBox";
import { DeedFees } from "./DeedFees";
import { RecentTrades } from "./RecentTrades";

// lightweight-charts ships in its own chunk — loaded only when a market renders.
const TradingChart = lazy(() => import("./TradingChart"));

/**
 * The coin/trading view for a claimed word. Composes the price header, an inline
 * price chart, the buy/sell box (whitelist-gated), the connected wallet's position,
 * the deed-holder fee-claim, and a recent-trades feed.
 *
 * Data sources are layered: `info` (from WordDetail.market, indexed) gives a fast
 * first paint and the aggregates; live contract reads keep the spot price, balance,
 * graduated flag and accrued fees fresh. Everything degrades to a clean empty state
 * for a brand-new market (seed price, no trades).
 */
export function WordMarketPanel({
  word,
  info,
  onChanged,
}: {
  word: string;
  /** Indexed market snapshot; null while the API hasn't surfaced one yet. */
  info: MarketInfo | null;
  /** Refetch the parent word detail after a trade / fee claim. */
  onChanged: () => void;
}) {
  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();

  const marketAddr = asMarketAddress(info?.market);
  const reads = useMarketReads(info?.market);
  const balanceQuery = useTokenBalance(info?.market, address);
  const balance = (balanceQuery.data as bigint | undefined) ?? 0n;

  // The market address comes from the INDEXER (API data), but the TradeBox sends
  // real ETH to it. Confirm it against the on-chain registry before rendering any
  // write surface — a compromised API must never be able to redirect a buy.
  const wordTokenId = wordToTokenId(word);
  const { data: registryMarket } = useReadContract({
    address: registryAddress,
    abi: wordRegistryAbi,
    functionName: "marketOfTokenId",
    args: wordTokenId !== null ? [wordTokenId] : undefined,
    query: { enabled: ADDRESSES_READY && wordTokenId !== null && Boolean(marketAddr) },
  });
  const marketVerified =
    Boolean(marketAddr) &&
    typeof registryMarket === "string" &&
    registryMarket.toLowerCase() === marketAddr!.toLowerCase();

  // After a trade / fee claim, refresh the INDEXER-derived word detail (onChanged)
  // AND the live on-chain reads (price, market cap, the wallet's balance) right away
  // — so "Your position" reflects the buy the instant it confirms, no page refresh.
  function handleChanged() {
    onChanged();
    void reads.refetch?.();
    void balanceQuery.refetch?.();
  }

  // Live reads win over indexed values for the fields that move every trade.
  // Indexer strings go through toWei (null on garbage) — a malformed API value
  // must degrade to a skeleton, not throw in render and trip the ErrorBoundary.
  const priceWei = reads.priceWei ?? (info ? (toWei(info.priceWei) ?? undefined) : undefined);
  const marketCapWei =
    reads.marketCapWei ?? (info ? (toWei(info.marketCapWei) ?? undefined) : undefined);
  const volumeWei = reads.volumeWei ?? (info ? (toWei(info.volumeWei) ?? undefined) : undefined);
  const graduated = reads.graduated ?? info?.graduated ?? false;
  const symbol = reads.symbol ?? info?.tokenSymbol;
  const deedOwner = reads.deedOwner ?? null;
  const deedFeesWei = reads.deedFeesWei ?? (info ? (toWei(info.deedFeesWei) ?? 0n) : 0n);

  // Graduation progress (the FOMO centerpiece). Indexed-only fields — guard for
  // older API snapshots that may omit them.
  const progressBps = info?.graduationProgressBps;
  const progressPct =
    typeof progressBps === "number" ? Math.max(0, Math.min(100, progressBps / 100)) : null;
  const traders = info?.traders;

  const isDeedOwner =
    Boolean(address) && Boolean(deedOwner) && normAddr(address) === normAddr(deedOwner);

  // 24h price change — the "is this alive" signal. Hourly candles, baseline is
  // the last close before the 24h window (or the window's first open).
  const candles1h = useQuery({
    queryKey: ["chart", word, 3600],
    queryFn: () => api.candles(word, 3600),
    retry: 1,
    enabled: Boolean(info),
    refetchInterval: 60_000,
  });
  const change24h = useMemo(() => {
    const cs = candles1h.data ?? [];
    if (cs.length === 0) return null;
    const dayAgo = Math.floor(Date.now() / 1000) - 86_400;
    const inWindow = cs.filter((c) => c.t >= dayAgo);
    // No trades in the window -> no chip. A "+0.0%" on a dead market implies life.
    if (inWindow.length === 0) return null;
    const toNum = (wei: string) => {
      try {
        return Number(BigInt(wei));
      } catch {
        return 0;
      }
    };
    const last = toNum(cs[cs.length - 1].c);
    const before = cs.filter((c) => c.t < dayAgo);
    const base = before.length
      ? toNum(before[before.length - 1].c)
      : toNum(inWindow[0]?.o ?? cs[0].o);
    if (!(base > 0)) return null;
    const pct = ((last - base) / base) * 100;
    // Kill the "-0.0%" rendering artifact for sub-0.05% moves.
    return Math.abs(pct) < 0.05 ? 0 : pct;
  }, [candles1h.data]);

  // Flash the price green/red for ~1s whenever it ticks — the live "wow" beat.
  const [priceFlash, setPriceFlash] = useState<"" | "price-up" | "price-down">("");
  const prevPrice = useRef<bigint | undefined>(undefined);
  useEffect(() => {
    if (priceWei === undefined) return;
    const prev = prevPrice.current;
    prevPrice.current = priceWei;
    if (prev === undefined || priceWei === prev) return;
    setPriceFlash(priceWei > prev ? "price-up" : "price-down");
    const t = setTimeout(() => setPriceFlash(""), 1000);
    return () => clearTimeout(t);
  }, [priceWei]);

  // No market indexed yet (fresh claim mid-sync, or API not live). Keep it quiet —
  // the deed sections still render above this panel.
  if (!info || !marketAddr) {
    return null;
  }

  return (
    <section
      className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_360px]"
      aria-label="Token market"
    >
      {/* LEFT: price, chart, trades */}
      <div className="flex min-w-0 flex-col gap-4">
        {/* Price header */}
        <Card className="fade-up p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>Price</span>
                {symbol && <Pill>{symbol}</Pill>}
                {graduated && <Pill tone="warning">graduated 🎓</Pill>}
                {typeof traders === "number" && (
                  <span className="tabular-nums text-faint">
                    {traders.toLocaleString()} {traders === 1 ? "trader" : "traders"}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-baseline gap-2.5">
                <div className={`mt-1 text-3xl font-semibold tabular-nums sm:text-4xl ${priceFlash}`}>
                  {priceWei !== undefined ? ethLabel(priceWei) : <Skeleton className="h-9 w-40" />}
                </div>
                {change24h !== null && (
                  <span
                    className={`text-sm font-medium tabular-nums ${
                      change24h >= 0 ? "text-positive" : "text-negative"
                    }`}
                    title="Change over the last 24 hours"
                  >
                    {change24h >= 0 ? "+" : ""}
                    {change24h.toFixed(1)}% <span className="text-xs font-normal">24h</span>
                  </span>
                )}
              </div>
            </div>
            <div className="flex gap-6 text-right">
              <Metric
                label="Market cap"
                value={marketCapWei !== undefined ? ethLabel(marketCapWei) : undefined}
              />
              <Metric
                label="Volume"
                value={volumeWei !== undefined ? ethLabel(volumeWei) : undefined}
              />
            </div>
          </div>

          {/* Graduation progress — the FOMO bar. */}
          <GraduationBar
            pct={progressPct}
            graduated={graduated}
            realEthReserveWei={info.realEthReserveWei}
            graduationThresholdWei={info.graduationThresholdWei}
          />
        </Card>

        {/* Trading chart (candles + volume) */}
        <Suspense fallback={<Skeleton className="h-[320px] w-full rounded-xl" />}>
          <TradingChart word={word} />
        </Suspense>

        {/* Recent trades */}
        <RecentTrades word={word} symbol={symbol} />
      </div>

      {/* RIGHT: sticky trade rail */}
      <div className="flex flex-col gap-4 lg:sticky lg:top-[84px]">
        {/* Buy / Sell box. After graduation the contract freezes buys but keeps
            sell() open, so we keep the Sell tab usable and only freeze Buy. */}
        {!isConnected || wrongNetwork ? (
          <Card className="fade-up flex flex-col items-center gap-3 p-5 text-sm text-muted">
            <span>
              {wrongNetwork
                ? `Switch network to trade ${symbol ? `$${symbol}` : "this coin"}.`
                : `Connect your wallet to trade ${symbol ? `$${symbol}` : "this coin"}.`}
            </span>
            <WalletButton />
          </Card>
        ) : !marketVerified ? (
          // Registry check pending (skeleton) or FAILED (API said one market, the
          // chain says another) — never show a buy box that pays the wrong address.
          registryMarket === undefined ? (
            <Skeleton className="h-[260px] w-full rounded-xl" />
          ) : (
            <Card className="p-5 text-center text-sm text-warning">
              This market didn’t match the on-chain registry. Trading is disabled here —
              try reloading.
            </Card>
          )
        ) : (
          // No WhitelistGate around the whole box: sell() is permissionless on-chain
          // (the exit must never depend on the allowlist), so the Sell tab renders for
          // everyone; the gate is applied to the BUY side inside TradeBox.
          <TradeBox
            market={marketAddr}
            symbol={symbol}
            word={word}
            buyFrozen={graduated}
            onTraded={handleChanged}
          />
        )}

        {/* Your position */}
        {isConnected && (
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="text-xs text-muted">Your position</p>
              <p className="text-lg font-semibold tabular-nums">{tokenLabel(balance, symbol)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted">Value</p>
              <p className="text-sm font-medium tabular-nums">
                {priceWei !== undefined ? ethLabel((balance * priceWei) / 10n ** 18n) : "—"}
              </p>
            </div>
          </Card>
        )}

        {/* Deed-holder fees (cash-flow hook) — same registry gate as the TradeBox. */}
        {isDeedOwner && marketVerified && (
          <DeedFees market={marketAddr} word={word} feesWei={deedFeesWei} onClaimed={handleChanged} />
        )}

        {/* About this market — real indexed/live fields. */}
        <Card className="p-4">
          <h3 className="mb-2 text-sm font-medium text-muted">About this market</h3>
          <AboutRow label="Symbol" value={symbol ? `$${symbol}` : "—"} />
          {typeof traders === "number" && (
            <AboutRow label="Traders" value={traders.toLocaleString()} />
          )}
          <AboutRow
            label="Volume"
            value={volumeWei !== undefined ? ethLabel(volumeWei) : "—"}
          />
          <AboutRow
            label="In bonding curve"
            value={`${ethLabel(info.realEthReserveWei)} / ${ethLabel(info.graduationThresholdWei)}`}
          />
          <AboutRow label="Status" value={graduated ? "Graduated 🎓" : "Live"} last />
        </Card>
      </div>
    </section>
  );
}

function AboutRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 text-[13px] ${
        last ? "" : "border-b border-border"
      }`}
    >
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

/**
 * The graduation FOMO bar: "73% to graduation · 7.3 / 10 ETH". When graduated,
 * shows a full, celebratory state. Degrades to nothing if the API snapshot is
 * too old to carry progress fields.
 */
function GraduationBar({
  pct,
  graduated,
  realEthReserveWei,
  graduationThresholdWei,
}: {
  pct: number | null;
  graduated: boolean;
  realEthReserveWei: string;
  graduationThresholdWei: string;
}) {
  if (pct === null && !graduated) return null;
  const shown = graduated ? 100 : (pct ?? 0);

  return (
    <div className="mt-5 border-t border-border pt-4">
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-fg">
          {graduated ? "🎓 Graduated" : `${shown.toFixed(0)}% to graduation`}
        </span>
        <span className="tabular-nums text-muted">
          {ethLabel(realEthReserveWei)} / {ethLabel(graduationThresholdWei)}
        </span>
      </div>
      <div
        className={`relative h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ${
          graduated ? "" : "grad-sheen"
        }`}
        role="progressbar"
        aria-valuenow={Math.round(shown)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Graduation progress"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ${
            graduated ? "bg-warning" : "bg-positive"
          }`}
          style={{ width: `${shown}%` }}
        />
      </div>
      {!graduated && (
        <p className="mt-1.5 text-xs text-faint">
          When the curve fills, buys freeze and the token graduates. Selling stays open.
        </p>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-medium tabular-nums">
        {value ?? <Skeleton className="ml-auto h-4 w-16" />}
      </p>
    </div>
  );
}
