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
import { ActivityFeed } from "../components/ActivityFeed";
import { useToast } from "../components/Toast";
import { friendlyError, ethLabel } from "../lib/format";
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

  return (
    <div className="mx-auto max-w-2xl">
      <div className="py-8 text-center sm:py-14">
        <h1 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Claim a word.
        </h1>
        <p className="mt-3 text-muted">Only one will ever exist.</p>
      </div>

      <Card className="p-2 sm:p-3">
        <label htmlFor="claim-word-input" className="sr-only">
          Word to claim
        </label>
        <input
          id="claim-word-input"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="type a word"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby="claim-status"
          className="word-display w-full bg-transparent px-3 py-4 text-center text-4xl outline-none placeholder:text-faint sm:text-5xl"
        />
      </Card>

      <div
        id="claim-status"
        role="status"
        aria-live="polite"
        className="mt-3 flex min-h-[2.5rem] items-center justify-center"
      >
        <StatusLine state={state} />
      </div>

      <div className="mt-2 space-y-3">
        {!isConnected ? (
          <div className="flex justify-center">
            <WalletButton />
          </div>
        ) : wrongNetwork ? (
          <div className="flex justify-center">
            <WalletButton />
          </div>
        ) : (
          <WhitelistGate>
            <div className="flex flex-col items-center gap-2">
              <Button
                className="w-full sm:w-auto"
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
              {outOfClaims && (
                <p className="text-xs text-warning">
                  You&apos;ve hit the claim limit for this wallet.
                </p>
              )}
            </div>
          </WhitelistGate>
        )}
      </div>

      {/* Anti-bot limit + remaining claims */}
      {isConnected && (
        <p className="mt-4 text-center text-xs text-muted">
          {remainingNum !== undefined && maxClaims !== undefined
            ? `${remainingNum} of ${Number(maxClaims)} claims remaining for this wallet`
            : "Claims are limited per wallet to keep things fair."}
        </p>
      )}

      {/* Live counters */}
      <div className="mt-12 grid grid-cols-2 gap-3 sm:gap-4">
        <Stat
          label="Words claimed"
          value={stats?.wordsClaimed}
          error={statsError}
          onRetry={() => void refetchStats()}
        />
        <Stat
          label="Unique owners"
          value={stats?.uniqueOwners}
          error={statsError}
          onRetry={() => void refetchStats()}
        />
      </div>

      {/* Live activity */}
      <section className="mt-12">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted">Live</h2>
          <Link to="/activity" className="text-xs text-muted hover:text-fg">
            View all →
          </Link>
        </div>
        <ActivityFeed limit={6} compact />
      </section>
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

function Stat({
  label,
  value,
  error,
  onRetry,
}: {
  label: string;
  value?: number;
  error?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Card className="p-5 text-center">
      <div className="text-2xl font-semibold tabular-nums">
        {error ? (
          <button onClick={onRetry} className="text-base font-normal text-muted underline">
            retry
          </button>
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
