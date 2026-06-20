import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { normalizeWord } from "@shared/normalize";
import { api } from "../api";
import { registryAddress, wordRegistryAbi } from "../contracts";
import { Button, Card, Spinner, Pill } from "../components/ui";
import { WhitelistGate } from "../components/WhitelistGate";
import { WalletButton } from "../components/WalletButton";
import { ActivityFeed, LiveBadge } from "../components/ActivityFeed";
import { DiscoveryBoard } from "../components/DiscoveryBoard";
import { useToast } from "../components/Toast";
import { friendlyError, ethLabel, formatEthAmount } from "../lib/format";
import { useCountUp } from "../hooks/useCountUp";
import { useSyncAfterTx } from "../hooks/useSyncAfterTx";
import {
  useClaimFee,
  useMaxClaims,
  useRemainingClaims,
  useWrongNetwork,
} from "../hooks/useRegistry";

type State =
  | { kind: "idle" }
  | { kind: "invalid"; reason: string }
  | { kind: "checking"; normalized: string }
  | { kind: "available"; normalized: string }
  | { kind: "taken"; normalized: string };

export function Home() {
  const [raw, setRaw] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const navigate = useNavigate();
  const toast = useToast();

  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();

  const { data: stats, isError: statsError, refetch: refetchStats } = useQuery({
    queryKey: ["stats"],
    queryFn: api.stats,
    retry: 1,
    refetchInterval: 10_000,
  });
  const { data: claimFee } = useClaimFee();
  const { data: maxClaims } = useMaxClaims();
  const { data: remaining, refetch: refetchRemaining } = useRemainingClaims(address);
  const { sync, syncing } = useSyncAfterTx();

  // Live, local-first validation. Normalize instantly; only hit /check for taken-state.
  const norm = useMemo(() => normalizeWord(raw), [raw]);

  useEffect(() => {
    if (raw.trim() === "") {
      setState({ kind: "idle" });
      return;
    }
    if (!norm.ok) {
      setState({ kind: "invalid", reason: norm.reason });
      return;
    }
    let cancelled = false;
    setState({ kind: "checking", normalized: norm.normalized });
    const t = window.setTimeout(async () => {
      try {
        const res = await api.check(norm.normalized);
        if (cancelled) return;
        setState({
          kind: res.available ? "available" : "taken",
          normalized: norm.normalized,
        });
      } catch {
        // If the indexer is unreachable we still allow attempting a claim;
        // treat as available but the chain remains source of truth.
        if (!cancelled) setState({ kind: "available", normalized: norm.normalized });
      }
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [raw, norm.ok, norm.normalized, norm.reason]);

  const { writeContract, data: hash, isPending, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess && state.kind !== "idle") {
      const w = "normalized" in state ? state.normalized : raw;
      toast.success(`Claimed "${w}"`);
      void refetchRemaining();
      // Prime caches and wait out indexer lag before navigating, so the word page
      // doesn't briefly render a stale "unclaimed" state for the word we just claimed.
      void sync([["stats"], ["activity"], ["word", w]], { attempts: 2, intervalMs: 1200 }).then(
        () => {
          navigate(`/word/${encodeURIComponent(w)}`);
          reset();
        },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const remainingNum = remaining !== undefined ? Number(remaining) : undefined;
  const outOfClaims = remainingNum !== undefined && remainingNum <= 0;

  function doClaim() {
    if (state.kind !== "available") return;
    writeContract(
      {
        address: registryAddress,
        abi: wordRegistryAbi,
        functionName: "claim",
        args: [state.normalized],
        value: (claimFee as bigint | undefined) ?? 0n,
      },
      {
        onError: (e) => toast.error(friendlyError(e)),
        onSuccess: () => toast.info("Claiming… confirm in your wallet"),
      },
    );
  }

  const claimAction = (
    <WhitelistGate compact>
      <Button
        className="shrink-0"
        onClick={doClaim}
        disabled={
          state.kind !== "available" ||
          isPending ||
          confirming ||
          syncing ||
          outOfClaims ||
          claimFee === undefined /* M3/M4: never enable a claim before the fee is known */
        }
      >
        {isPending || confirming || syncing ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : "Claiming…"}
          </>
        ) : claimFee !== undefined ? (
          `Claim${(claimFee as bigint) > 0n ? ` · ${ethLabel(claimFee as bigint)}` : " (free)"}`
        ) : (
          <>
            <Spinner /> Loading fee…
          </>
        )}
      </Button>
    </WhitelistGate>
  );

  return (
    <div>
      {/* Hero / claim */}
      <section className="fade-up mx-auto mb-11 max-w-[680px] text-center">
        <h1 className="text-balance text-3xl font-semibold leading-[1.05] tracking-tight sm:text-[44px]">
          Claim a word.
          <br />
          Own it forever.
        </h1>
        <p className="mx-auto mt-4 max-w-[52ch] text-muted">
          Every word can be claimed only once, ever. Claiming mints a 1-of-1 deed —
          global uniqueness enforced on-chain. No images, no descriptions. Just the word.
        </p>

        <div className="mt-7 flex items-center gap-2 rounded-xl border border-border bg-surface p-2 pl-4 text-left shadow-sm">
          <label htmlFor="claim-word-input" className="sr-only">
            Word to claim
          </label>
          <input
            id="claim-word-input"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={(e) => {
              // Enter claims when the happy path is satisfied (mirrors the button's
              // enabled state); whitelist edge cases still surface via the toast.
              if (
                e.key === "Enter" &&
                state.kind === "available" &&
                isConnected &&
                !wrongNetwork &&
                !outOfClaims &&
                claimFee !== undefined &&
                !isPending &&
                !confirming &&
                !syncing
              ) {
                doClaim();
              }
            }}
            placeholder="type a word"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="claim-status"
            className="word-display caret-fg min-w-0 flex-1 bg-transparent text-xl outline-none placeholder:text-faint focus:placeholder:text-transparent sm:text-2xl"
          />
          {!isConnected || wrongNetwork ? <WalletButton /> : claimAction}
        </div>

        <div
          id="claim-status"
          role="status"
          aria-live="polite"
          className="mt-2.5 flex min-h-[1.75rem] items-center justify-center"
        >
          <StatusLine state={state} />
        </div>

        {isConnected && outOfClaims && (
          <p className="mt-1 text-xs text-warning">
            You&apos;ve hit the claim limit for this wallet.
          </p>
        )}
        {isConnected && (
          <p className="mt-1 text-xs text-faint">
            {remainingNum !== undefined && maxClaims !== undefined
              ? `${remainingNum} of ${Number(maxClaims)} claims remaining for this wallet`
              : "Claims are limited per wallet to keep things fair."}
          </p>
        )}
        <p className="mt-4 text-xs text-faint">
          Closed beta · whitelisted wallets · testnet only, not an investment product
        </p>
      </section>

      {/* Browse: discovery grid + sticky live sidebar */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <DiscoveryBoard />
        </div>

        <aside className="flex flex-col gap-5 lg:sticky lg:top-[84px]">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium text-muted">
                Live activity <LiveBadge />
              </h2>
            </div>
            <ActivityFeed limit={6} compact live />
            <Link
              to="/activity"
              className="mt-2.5 block text-[13px] text-muted hover:text-fg"
            >
              View all activity →
            </Link>
          </div>

          <Card className="p-4">
            <SideStat
              label="Words claimed"
              value={stats?.wordsClaimed}
              error={statsError}
              onRetry={() => void refetchStats()}
            />
            <SideStat
              label="Unique owners"
              value={stats?.uniqueOwners}
              error={statsError}
              onRetry={() => void refetchStats()}
            />
            <SideStat
              label="Total volume"
              ethWei={stats?.totalVolumeWei}
              error={statsError}
              onRetry={() => void refetchStats()}
            />
          </Card>
        </aside>
      </div>
    </div>
  );
}

function StatusLine({ state }: { state: State }) {
  switch (state.kind) {
    case "idle":
      return <span className="text-xs text-faint">a–z and 0–9, up to 30 characters</span>;
    case "invalid":
      return <Pill tone="negative">Invalid · {state.reason}</Pill>;
    case "checking":
      return (
        <span className="flex items-center gap-2 text-xs text-muted">
          <Spinner /> checking “{state.normalized}”…
        </span>
      );
    case "available":
      return <Pill tone="positive">“{state.normalized}” is available</Pill>;
    case "taken":
      return <Pill tone="warning">“{state.normalized}” is taken</Pill>;
  }
}

/**
 * Compact sidebar stat row (label left, live value right). Count-ups numeric
 * stats for the live feel; for ETH it tracks the trimmed label's numeric value
 * but rests on the exact ethLabel string so we never show a lossy float.
 */
function SideStat({
  label,
  value,
  ethWei,
  error,
  onRetry,
}: {
  label: string;
  value?: number;
  ethWei?: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  const ethTarget =
    ethWei !== undefined ? Number(formatEthAmount(ethWei).replace(/,/g, "")) : undefined;
  const animated = useCountUp(ethWei !== undefined ? ethTarget : value);

  let display: string;
  if (error) {
    display = "";
  } else if (ethWei !== undefined) {
    display =
      ethTarget === undefined ? "—" : `${(animated ?? ethTarget).toFixed(ethTarget >= 1 ? 2 : 4)} ETH`;
  } else if (value === undefined || animated === null) {
    display = "—";
  } else {
    display = Math.round(animated).toLocaleString();
  }

  return (
    <div className="flex items-center justify-between py-1.5 text-[13px]">
      <span className="text-muted">{label}</span>
      {error ? (
        <button onClick={onRetry} className="font-medium text-muted underline">
          retry
        </button>
      ) : (
        <span className="font-semibold tabular-nums">{display}</span>
      )}
    </div>
  );
}
