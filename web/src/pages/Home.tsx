import { useEffect, useMemo, useState, type CSSProperties } from "react";
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
import { Button, Card, Spinner, Pill, Skeleton, ErrorState } from "../components/ui";
import { WhitelistGate } from "../components/WhitelistGate";
import { useConnectModal } from "../components/ConnectModal";
import { WalletButton } from "../components/WalletButton";
import { LiveBadge } from "../components/ActivityFeed";
import { DiscoveryBoard } from "../components/DiscoveryBoard";
import { UserBadge } from "../components/UserBadge";
import { useToast } from "../components/Toast";
import { friendlyError, ethLabel, timeAgo } from "../lib/format";
import { useSyncAfterTx } from "../hooks/useSyncAfterTx";
import { useClaimFee, useRemainingClaims, useWrongNetwork } from "../hooks/useRegistry";

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

  // Smash feedback — the visceral core of the brand. Firing increments a key that
  // remounts the particle burst and toggles a brief screen-shake on the hero.
  const [burstKey, setBurstKey] = useState(0);
  const [shake, setShake] = useState(false);
  function fireSmash() {
    setBurstKey((k) => k + 1);
    setShake(true);
    window.setTimeout(() => setShake(false), 420);
  }

  const { address, isConnected } = useAccount();
  const wrongNetwork = useWrongNetwork();
  const { open: openConnect } = useConnectModal();

  const { data: claimFee } = useClaimFee();
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
      fireSmash(); // celebration burst the moment the claim lands
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

  // The giant live word above the input, lit volt when it's yours to take.
  const bigWord = norm.ok ? norm.normalized : raw.trim();
  const bigWordClass =
    state.kind === "available" || state.kind === "checking"
      ? "text-volt"
      : state.kind === "taken"
        ? "text-muted line-through decoration-2"
        : "text-faint";

  function doClaim() {
    if (state.kind !== "available") return;
    if (!isConnected) {
      openConnect(); // not signed in -> open the sign-in modal instead of claiming
      return;
    }
    fireSmash(); // instant tactile feedback on intent, before the wallet round-trip
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
        className="w-full !bg-[rgb(var(--c-volt))] !text-white volt-glow"
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
            <Spinner /> {syncing ? "Syncing…" : "Keeping…"}
          </>
        ) : claimFee !== undefined ? (
          `Keep it${(claimFee as bigint) > 0n ? ` · ${ethLabel(claimFee as bigint)}` : " (free)"}`
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
      {/* SMASH hero — the page leads with energy, not data. The typed word slams in
          on every keystroke; claiming fires a particle burst + impact shake. */}
      <section className={`fade-up mb-10 ${shake ? "smash-shake" : ""}`}>
        <h1 className="font-display text-balance text-[30px] font-semibold leading-[1.05] tracking-tight sm:text-[40px]">
          Keep a <span className="text-volt">word</span>.{" "}
          <span className="text-muted">Own it forever.</span>
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          One word, one owner. You earn every time it trades.
        </p>

        {/* Live word preview — only while typing, modest + left-aligned (no giant idle splash). */}
        {bigWord && (
          <div
            key={bigWord}
            className={`smash-punch word-display mt-4 max-w-full select-none overflow-hidden break-all text-4xl leading-none sm:text-5xl ${bigWordClass}`}
          >
            {bigWord}
          </div>
        )}

        <div className="mt-5 max-w-[460px]">
          <div
            className={`relative flex items-center rounded-xl border bg-surface px-4 py-3.5 shadow-sm transition ${
              state.kind === "available" ? "border-transparent volt-glow" : "border-border"
            }`}
          >
            <SmashBurst fireKey={burstKey} />
            <label htmlFor="claim-word-input" className="sr-only">
              Word to claim
            </label>
            <input
              id="claim-word-input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onKeyDown={(e) => {
                // Enter claims when the happy path is satisfied (mirrors the button).
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
              placeholder="type a word…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-describedby="claim-status"
              className="word-display caret-fg w-full bg-transparent text-xl outline-none placeholder:text-faint focus:placeholder:text-transparent"
            />
          </div>

          <div
            id="claim-status"
            role="status"
            aria-live="polite"
            className="mt-2 flex min-h-[1.25rem] items-center"
          >
            <StatusLine state={state} />
          </div>

          <div className="mt-2">
            {isConnected && wrongNetwork ? <WalletButton fullWidth /> : claimAction}
          </div>

          {isConnected && outOfClaims && (
            <p className="mt-2 text-xs text-warning">
              You&apos;ve hit the claim limit for this wallet.
            </p>
          )}
        </div>
      </section>

      {/* The buzz — a live wall of claimed words. */}
      <WordGrid />

      {/* Discover */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-sm font-medium text-muted">Discover</h2>
          <Link to="/top" className="text-xs text-muted hover:text-fg">
            Leaderboard →
          </Link>
        </div>
        <DiscoveryBoard />
      </section>
    </div>
  );
}

function StatusLine({ state }: { state: State }) {
  switch (state.kind) {
    case "idle":
      return null;
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
 * Radial particle burst. Keyed by `fireKey` so each smash remounts it and replays
 * the animation from scratch. Particles fly out along evenly-spread vectors.
 */
function SmashBurst({ fireKey }: { fireKey: number }) {
  if (fireKey === 0) return null;
  const count = 16;
  const parts = Array.from({ length: count }, (_, i) => {
    const ang = (Math.PI * 2 * i) / count + (i % 2 ? 0.35 : 0);
    const dist = 70 + (i % 4) * 26;
    return {
      dx: Math.round(Math.cos(ang) * dist),
      dy: Math.round(Math.sin(ang) * dist),
      delay: (i % 5) * 0.012,
    };
  });
  return (
    <div key={fireKey} className="pointer-events-none absolute inset-0 z-10" aria-hidden="true">
      {parts.map((p, i) => (
        <span
          key={i}
          className="smash-particle"
          style={
            {
              "--dx": `${p.dx}px`,
              "--dy": `${p.dy}px`,
              animationDelay: `${p.delay}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}


/**
 * The buzz — a wall of recently-claimed words as cards (pump-style). Real
 * /words?sort=recent data, or curated demo words when the chain is still empty.
 */
function WordGrid() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["words", "recent"],
    queryFn: () => api.words("recent"),
    retry: 1,
    refetchInterval: 12_000,
  });
  const words = (data?.items ?? []).slice(0, 12);

  return (
    <section aria-label="Recently claimed" className="mb-12">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-medium text-muted">
        Just claimed <LiveBadge />
      </h2>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="p-4">
              <Skeleton className="h-7 w-24" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load the feed." onRetry={() => void refetch()} />
      ) : words.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No words claimed yet. Be the first.</Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {words.map((w) => (
            <Link
              key={w.tokenId}
              to={`/word/${encodeURIComponent(w.word)}`}
              className="card-lift flex flex-col justify-between rounded-xl border border-border bg-surface p-4 transition hover:!border-[rgb(var(--c-volt))]"
            >
              <span className="word-display truncate text-[26px]">{w.word}</span>
              <span className="mt-3 flex items-center justify-between gap-2 text-xs text-muted">
                <UserBadge address={w.owner} size={18} link={false} textClassName="text-xs" />
                <span className="shrink-0 tabular-nums text-faint">{timeAgo(w.claimedAt)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
