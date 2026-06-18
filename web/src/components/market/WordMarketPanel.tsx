import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { MarketInfo } from "@shared/types";
import { api } from "../../api";
import { Card, Pill, Skeleton } from "../ui";
import { WhitelistGate } from "../WhitelistGate";
import { WalletButton } from "../WalletButton";
import { ethLabel, tokenLabel, normAddr } from "../../lib/format";
import { useWrongNetwork } from "../../hooks/useRegistry";
import { asMarketAddress, useMarketReads, useTokenBalance } from "../../hooks/useMarket";
import { PriceChart } from "./PriceChart";
import { TradeBox } from "./TradeBox";
import { DeedFees } from "./DeedFees";
import { RecentTrades } from "./RecentTrades";

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
  const { data: balanceRaw } = useTokenBalance(info?.market, address);
  const balance = (balanceRaw as bigint | undefined) ?? 0n;

  const chart = useQuery({
    queryKey: ["chart", word],
    queryFn: () => api.chart(word),
    retry: 1,
    enabled: Boolean(info),
  });

  // Live reads win over indexed values for the fields that move every trade.
  const priceWei = reads.priceWei ?? (info ? BigInt(info.priceWei) : undefined);
  const marketCapWei = reads.marketCapWei ?? (info ? BigInt(info.marketCapWei) : undefined);
  const volumeWei = reads.volumeWei ?? (info ? BigInt(info.volumeWei) : undefined);
  const graduated = reads.graduated ?? info?.graduated ?? false;
  const symbol = reads.symbol ?? info?.tokenSymbol;
  const deedOwner = reads.deedOwner ?? null;
  const deedFeesWei = reads.deedFeesWei ?? (info ? BigInt(info.deedFeesWei) : 0n);

  const isDeedOwner =
    Boolean(address) && Boolean(deedOwner) && normAddr(address) === normAddr(deedOwner);

  // No market indexed yet (fresh claim mid-sync, or API not live). Keep it quiet —
  // the deed sections still render above this panel.
  if (!info || !marketAddr) {
    return null;
  }

  return (
    <section className="space-y-4" aria-label="Token market">
      {/* Price header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>Price</span>
              {symbol && <Pill>{symbol}</Pill>}
              {graduated && <Pill tone="warning">graduated</Pill>}
            </div>
            <div className="mt-1 text-3xl font-semibold tabular-nums sm:text-4xl">
              {priceWei !== undefined ? ethLabel(priceWei) : <Skeleton className="h-9 w-40" />}
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
      </Card>

      {/* Price chart */}
      {chart.isLoading ? (
        <Skeleton className="h-[120px] w-full rounded-xl" />
      ) : (
        <PriceChart points={chart.data ?? []} />
      )}

      {/* Buy / Sell box */}
      {graduated ? (
        <Card className="p-5 text-center text-sm text-muted">
          This market has <span className="font-medium text-fg">graduated</span> — bonding-curve
          trading is frozen.
        </Card>
      ) : !isConnected || wrongNetwork ? (
        <Card className="flex flex-col items-center gap-3 p-5 text-sm text-muted">
          <span>Connect your wallet to trade {symbol ? `$${symbol}` : "this coin"}.</span>
          <WalletButton />
        </Card>
      ) : (
        <WhitelistGate>
          <TradeBox market={marketAddr} symbol={symbol} word={word} onTraded={onChanged} />
        </WhitelistGate>
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

      {/* Deed-holder fees (cash-flow hook) */}
      {isDeedOwner && (
        <DeedFees market={marketAddr} word={word} feesWei={deedFeesWei} onClaimed={onChanged} />
      )}

      {/* Recent trades */}
      <RecentTrades word={word} symbol={symbol} />
    </section>
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
