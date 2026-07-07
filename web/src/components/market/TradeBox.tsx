import { useEffect, useMemo, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits, type Address } from "viem";
import { useAccount, useBalance, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { wordMarketAbi } from "../../contracts";
import { activeChain } from "../../wagmi";
import { useReceiptError } from "../../hooks/useReceiptError";
import { WhitelistGate } from "../WhitelistGate";
import { Button, Card, Spinner } from "../ui";
import { useToast } from "../Toast";
import { ethLabel, friendlyError, tokenLabel } from "../../lib/format";
import { useSyncAfterTx } from "../../hooks/useSyncAfterTx";
import { useQuoteBuy, useQuoteSell, useTokenBalance } from "../../hooks/useMarket";
import { tradesKey } from "./RecentTrades";

type Tab = "buy" | "sell";

// Slippage presets (in basis points of the quote) the user can pick from.
const SLIPPAGE_PRESETS = [50, 100, 300] as const; // 0.5% · 1% · 3%
const DEFAULT_SLIPPAGE_BPS = 100; // 1%

/** Apply a slippage haircut to a quoted amount: floor(quote * (10000 - bps) / 10000). */
function applySlippage(quote: bigint, bps: number): bigint {
  return (quote * BigInt(10_000 - bps)) / 10_000n;
}

// Leave a little ETH for gas so "buy with everything" fails in-UI with words
// rather than at wallet gas estimation with a raw RPC error (generous for an L2).
const GAS_HEADROOM = parseEther("0.00001");

/**
 * Buy/Sell box — the centerpiece of the coin page. Lives *inside* a WhitelistGate
 * (rendered by the parent) so it only appears for wallets cleared to trade. After
 * graduation the contract freezes buys but keeps sell() open, so `buyFrozen`
 * disables only the Buy tab (and defaults the active tab to Sell) instead of
 * hiding the whole box.
 */
export function TradeBox({
  market,
  symbol,
  word,
  buyFrozen = false,
  onTraded,
}: {
  market: Address;
  symbol?: string | null;
  word: string;
  /** Graduated markets freeze buys; selling stays available. */
  buyFrozen?: boolean;
  /** Called after a confirmed trade so the parent can refetch its own reads. */
  onTraded: () => void;
}) {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>(buyFrozen ? "sell" : "buy");
  const [slippageBps, setSlippageBps] = useState<number>(DEFAULT_SLIPPAGE_BPS);

  // If the market graduates while open on the Buy tab, push the user to Sell.
  useEffect(() => {
    if (buyFrozen && tab === "buy") setTab("sell");
  }, [buyFrozen, tab]);

  return (
    <Card className="p-4">
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-1" role="tablist" aria-label="Trade">
        {(["buy", "sell"] as const).map((t) => {
          const disabled = buyFrozen && t === "buy";
          return (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              disabled={disabled}
              onClick={() => !disabled && setTab(t)}
              title={disabled ? "Buys are frozen. This market has graduated." : undefined}
              className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition disabled:cursor-not-allowed disabled:opacity-40 ${
                tab === t ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      {tab === "buy" ? (
        buyFrozen ? (
          <div className="rounded-lg bg-surface-2 p-5 text-center text-sm text-muted">
            This market has <span className="font-medium text-fg">graduated 🎓</span>. Buys are
            frozen. You can still sell your {symbol ? `$${symbol}` : "tokens"}.
          </div>
        ) : (
          // Whitelist gates BUYS only — selling is permissionless on-chain and must
          // stay reachable for any holder, allowlisted or not.
          <WhitelistGate>
            <BuyPanel
              market={market}
              symbol={symbol}
              word={word}
              slippageBps={slippageBps}
              onTraded={onTraded}
            />
          </WhitelistGate>
        )
      ) : (
        <SellPanel
          market={market}
          symbol={symbol}
          word={word}
          account={address}
          slippageBps={slippageBps}
          onTraded={onTraded}
        />
      )}

      <SlippageControl bps={slippageBps} onChange={setSlippageBps} />
    </Card>
  );
}

function SlippageControl({ bps, onChange }: { bps: number; onChange: (b: number) => void }) {
  return (
    <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-xs text-muted">
      <span>Max slippage</span>
      <div className="flex gap-1" role="radiogroup" aria-label="Max slippage tolerance">
        {SLIPPAGE_PRESETS.map((preset) => (
          <button
            key={preset}
            role="radio"
            aria-checked={bps === preset}
            onClick={() => onChange(preset)}
            className={`rounded-md px-2 py-0.5 tabular-nums transition ${
              bps === preset ? "bg-accent text-accent-fg" : "bg-surface-2 hover:text-fg"
            }`}
          >
            {preset / 100}%
          </button>
        ))}
      </div>
    </div>
  );
}

function BuyPanel({
  market,
  symbol,
  word,
  slippageBps,
  onTraded,
}: {
  market: Address;
  symbol?: string | null;
  word: string;
  slippageBps: number;
  onTraded: () => void;
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const { isLoading: confirming, isSuccess } = receipt;
  useReceiptError(receipt, "The buy");
  const { sync, syncing } = useSyncAfterTx();

  // Parse the ETH amount; null on empty/invalid (never throws into render).
  const ethWei = useMemo(() => {
    const s = input.trim();
    if (!s) return null;
    try {
      const v = parseEther(s);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [input]);

  const invalid = input.trim() !== "" && ethWei === null;

  // Show the wallet's ETH and refuse over-balance amounts here, with words —
  // not later at gas estimation with a raw RPC error. Leave gas headroom so a
  // "buy with everything" doesn't pass the UI only to die at gas estimation.
  const { address } = useAccount();
  const { data: ethBal } = useBalance({ address, query: { refetchInterval: 15_000 } });
  const spendable =
    ethBal !== undefined ? (ethBal.value > GAS_HEADROOM ? ethBal.value - GAS_HEADROOM : 0n) : undefined;
  const overBalance = ethWei !== null && spendable !== undefined && ethWei > spendable;

  const {
    data: quote,
    isFetching: quoting,
    isError: quoteFailed,
  } = useQuoteBuy(market, ethWei !== null && !overBalance ? ethWei : null);
  const tokensOut = quote as bigint | undefined;
  const minOut = tokensOut !== undefined ? applySlippage(tokensOut, slippageBps) : undefined;

  useEffect(() => {
    if (isSuccess) {
      toast.success("Bought");
      setInput("");
      // Immediately refresh on-chain reads (your position + price) so the buy shows
      // the instant it confirms; then again once the indexer catches up (chart/trades).
      onTraded();
      void sync([["word", word], ["chart", word], tradesKey(word)]).then(onTraded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const busy = isPending || confirming || syncing;
  // Require a POSITIVE min-out: a 0 quote (buys frozen post-graduation, or a dust
  // amount) must never submit an unprotected trade.
  const canSubmit = ethWei !== null && !overBalance && minOut !== undefined && minOut > 0n && !busy;

  return (
    <div className="space-y-3">
      <AmountInput
        id="buy-eth-input"
        label="You pay"
        value={input}
        onChange={setInput}
        suffix="ETH"
        invalid={invalid || overBalance}
      />
      {ethBal !== undefined && (
        <p className="text-xs text-faint">
          Balance: {Number(formatEther(ethBal.value)).toLocaleString("en-US", { maximumFractionDigits: 5 })} ETH
        </p>
      )}

      {/* One-tap amounts — most buys are a standard size, don't make people type. */}
      <div className="flex gap-1.5" role="group" aria-label="Quick amounts">
        {["0.001", "0.005", "0.01", "0.05"].map((v) => (
          <button
            key={v}
            onClick={() => setInput(v)}
            className={`flex-1 rounded-md px-1 py-1 text-xs tabular-nums transition ${
              input === v
                ? "bg-accent text-accent-fg"
                : "bg-surface-2 text-muted hover:text-fg"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <QuoteLine
        label="You receive (est.)"
        value={
          tokensOut !== undefined && ethWei !== null
            ? tokenLabel(tokensOut, symbol)
            : quoting && ethWei !== null
              ? "…"
              : "—"
        }
      />
      {quoteFailed && ethWei !== null && !overBalance && (
        <p className="text-xs text-warning">
          Couldn’t quote this amount — it may exceed what the curve can sell. Try a
          smaller amount.
        </p>
      )}
      {minOut !== undefined && (
        <p className="text-xs text-faint">
          Min after {slippageBps / 100}% slippage: {tokenLabel(minOut, symbol)}
        </p>
      )}

      <Button
        className="w-full"
        disabled={!canSubmit}
        onClick={() => {
          if (ethWei === null || minOut === undefined) return;
          writeContract(
            {
              address: market,
              abi: wordMarketAbi,
              functionName: "buy",
              args: [minOut],
              value: ethWei,
              chainId: activeChain.id,
            },
            {
              onError: (e) => toast.error(friendlyError(e)),
              onSuccess: () => toast.info("Buying… confirm in your wallet"),
            },
          );
        }}
      >
        {busy ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : "Buying…"}
          </>
        ) : (
          "Buy"
        )}
      </Button>
      {overBalance && <p className="text-xs text-negative">More than your ETH balance.</p>}
      {invalid && <p className="text-xs text-negative">Enter a positive ETH amount.</p>}
    </div>
  );
}

function SellPanel({
  market,
  symbol,
  word,
  account,
  slippageBps,
  onTraded,
}: {
  market: Address;
  symbol?: string | null;
  word: string;
  account?: Address;
  slippageBps: number;
  onTraded: () => void;
}) {
  const toast = useToast();
  const [input, setInput] = useState("");
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  const { isLoading: confirming, isSuccess } = receipt;
  useReceiptError(receipt, "The sell");
  const { sync, syncing } = useSyncAfterTx();

  const { data: balance, refetch: refetchBalance } = useTokenBalance(market, account);
  const bal = (balance as bigint | undefined) ?? 0n;

  const tokenWei = useMemo(() => {
    const s = input.trim();
    if (!s) return null;
    try {
      const v = parseUnits(s, 18);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [input]);

  const overBalance = tokenWei !== null && tokenWei > bal;
  const invalid = input.trim() !== "" && tokenWei === null;
  const {
    data: quote,
    isFetching: quoting,
    isError: quoteFailed,
  } = useQuoteSell(market, tokenWei !== null && !overBalance ? tokenWei : null);
  const ethOut = quote as bigint | undefined;
  const minOut = ethOut !== undefined ? applySlippage(ethOut, slippageBps) : undefined;

  useEffect(() => {
    if (isSuccess) {
      toast.success("Sold");
      setInput("");
      void refetchBalance();
      // Immediate on-chain refresh (position + price), then again after indexer sync.
      onTraded();
      void sync([["word", word], ["chart", word], tradesKey(word)]).then(onTraded);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const busy = isPending || confirming || syncing;
  // Require a POSITIVE min-out. On a graduated-but-not-migrated market sells stay
  // live, but a stale/0 quote must never send sell(amount, 0) — that would ship
  // with no slippage floor and hand a sandwicher the seller's proceeds.
  const canSubmit =
    tokenWei !== null && !overBalance && minOut !== undefined && minOut > 0n && bal > 0n && !busy;

  return (
    <div className="space-y-3">
      <AmountInput
        id="sell-token-input"
        label="You sell"
        value={input}
        onChange={setInput}
        suffix={symbol ?? "tokens"}
        invalid={invalid || overBalance}
        onMax={bal > 0n ? () => setInput(formatUnits(bal, 18)) : undefined /* exact wei — the display formatter truncates and would strand dust */}
      />
      <p className="text-xs text-faint">
        Balance: {tokenLabel(bal, symbol)}
      </p>

      {/* One-tap fractions of the position — exact wei, no typing. */}
      <div className="flex gap-1.5" role="group" aria-label="Quick amounts">
        {([25, 50, 100] as const).map((p) => (
          <button
            key={p}
            disabled={bal <= 0n}
            onClick={() => setInput(formatUnits((bal * BigInt(p)) / 100n, 18))}
            className="flex-1 rounded-md bg-surface-2 px-1 py-1 text-xs tabular-nums text-muted transition hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            {p === 100 ? "All" : `${p}%`}
          </button>
        ))}
      </div>

      <QuoteLine
        label="You receive (est.)"
        value={
          ethOut !== undefined && tokenWei !== null && !overBalance
            ? ethLabel(ethOut)
            : quoting && tokenWei !== null && !overBalance
              ? "…"
              : "—"
        }
      />
      {quoteFailed && tokenWei !== null && !overBalance && (
        <p className="text-xs text-warning">
          Couldn’t quote this amount — try a smaller one.
        </p>
      )}
      {minOut !== undefined && (
        <p className="text-xs text-faint">
          Min after {slippageBps / 100}% slippage: {ethLabel(minOut)}
        </p>
      )}

      <Button
        className="w-full"
        disabled={!canSubmit}
        onClick={() => {
          if (tokenWei === null || minOut === undefined) return;
          writeContract(
            {
              address: market,
              abi: wordMarketAbi,
              functionName: "sell",
              args: [tokenWei, minOut],
              chainId: activeChain.id,
            },
            {
              onError: (e) => toast.error(friendlyError(e)),
              onSuccess: () => toast.info("Selling… confirm in your wallet"),
            },
          );
        }}
      >
        {busy ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : "Selling…"}
          </>
        ) : (
          "Sell"
        )}
      </Button>
      {overBalance && <p className="text-xs text-negative">Amount exceeds your balance.</p>}
      {invalid && !overBalance && (
        <p className="text-xs text-negative">Enter a positive token amount.</p>
      )}
    </div>
  );
}

function AmountInput({
  id,
  label,
  value,
  onChange,
  suffix,
  invalid,
  onMax,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix: string;
  invalid?: boolean;
  onMax?: () => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      <div
        className={`flex items-center gap-2 rounded-lg border bg-surface px-3 py-2 ${
          invalid ? "border-negative/50" : "border-border focus-within:border-fg/40"
        }`}
      >
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          aria-invalid={invalid}
          className="min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        {onMax && (
          <button
            onClick={onMax}
            className="rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted hover:text-fg"
          >
            Max
          </button>
        )}
        <span className="shrink-0 text-xs font-medium text-muted">{suffix}</span>
      </div>
    </div>
  );
}

function QuoteLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
