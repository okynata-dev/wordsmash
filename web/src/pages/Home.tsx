import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { WalletButton } from "../components/WalletButton";
import { LiveBadge } from "../components/ActivityFeed";
import { DiscoveryBoard } from "../components/DiscoveryBoard";
import { UserBadge } from "../components/UserBadge";
import { useToast } from "../components/Toast";
import { friendlyError, ethLabel, timeAgo } from "../lib/format";
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
        className="shrink-0 !bg-[rgb(var(--c-volt))] !text-white volt-glow"
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
            <Spinner /> {syncing ? "Syncing…" : "Smashing…"}
          </>
        ) : claimFee !== undefined ? (
          `Smash it${(claimFee as bigint) > 0n ? ` · ${ethLabel(claimFee as bigint)}` : " (free)"}`
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
      <section
        className={`fade-up relative mx-auto mb-8 max-w-[680px] text-center ${shake ? "smash-shake" : ""}`}
      >
        <h1 className="font-display text-balance text-2xl font-semibold tracking-tight sm:text-[26px]">
          <span className="text-muted">Smash a word.</span> Own it forever.
        </h1>

        {/* Giant live word — the dopamine surface, lit volt when it's yours to take. */}
        <div className="relative mx-auto mt-5 mb-2 flex min-h-[84px] items-center justify-center sm:min-h-[120px]">
          <SmashBurst fireKey={burstKey} />
          <div
            key={bigWord || "empty"}
            className={`smash-punch word-display select-none break-all text-[3.25rem] leading-none sm:text-[5.5rem] ${bigWordClass}`}
          >
            {bigWord || <span className="text-faint">smash</span>}
          </div>
        </div>

        <div
          className={`mx-auto flex max-w-[560px] items-center gap-2 rounded-xl border bg-surface p-2 pl-4 text-left shadow-sm transition ${
            state.kind === "available" ? "border-transparent volt-glow" : "border-border"
          }`}
        >
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

        {/* Alive empty-state: real claimable words, one tap from smashing into the hero. */}
        <SuggestionChips onPick={(w) => setRaw(w)} />
      </section>

      {/* Slim social proof — only when there's real data; never a deflating 0/0. */}
      {stats && stats.wordsClaimed > 0 ? (
        <div className="fade-up mb-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 border-y border-border py-4">
          <Counter
            value={stats.wordsClaimed}
            label="words claimed"
            error={statsError}
            onRetry={() => void refetchStats()}
          />
          <Counter
            value={stats.uniqueOwners}
            label="owners"
            error={statsError}
            onRetry={() => void refetchStats()}
          />
          <span className="font-display text-sm text-muted">each word, once — never again</span>
        </div>
      ) : (
        <p className="fade-up mb-10 border-y border-border py-4 text-center font-display text-sm text-muted">
          each word, once — never again
        </p>
      )}

      {/* Live market: just-claimed (gone forever) + words on the secondary market */}
      <div className="mb-12 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <JustClaimed />
        <ForSale />
      </div>

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

/** Compact count-up stat for the slim social-proof strip. */
function Counter({
  value,
  label,
  error,
  onRetry,
}: {
  value?: number;
  label: string;
  error?: boolean;
  onRetry?: () => void;
}) {
  const animated = useCountUp(value);
  const display =
    error || value === undefined || animated === null ? "—" : Math.round(animated).toLocaleString();
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-display text-xl font-semibold tabular-nums">
        {error ? (
          <button onClick={onRetry} className="text-sm font-normal text-muted underline">
            retry
          </button>
        ) : (
          display
        )}
      </span>
      <span className="text-[11px] uppercase tracking-[0.12em] text-faint">{label}</span>
    </div>
  );
}

/** Curated, genuinely-claimable words — the empty-state has energy, not zeros. */
const SMASH_SUGGESTIONS = [
  "base", "degen", "gm", "alpha", "moon", "wagmi",
  "onchain", "based", "frens", "lfg", "vibe", "mint",
];

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

/** "Free words, waiting" — tapping one smashes it straight into the hero input. */
function SuggestionChips({ onPick }: { onPick: (w: string) => void }) {
  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] uppercase tracking-[0.14em] text-faint">free words, waiting</p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {SMASH_SUGGESTIONS.map((w) => (
          <button
            key={w}
            onClick={() => onPick(w)}
            className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted transition hover:border-[rgb(var(--c-volt))] hover:text-[rgb(var(--c-volt))]"
          >
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Live "just claimed" stream — real recently-claimed words from /words?sort=recent,
 * polled for a live feel. New rows slide in once (row-enter); each word is shown as
 * gone-forever (taken). Strict, monochrome, typographic — movement, not a casino.
 */
function JustClaimed() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["words", "recent"],
    queryFn: () => api.words("recent"),
    retry: 1,
    refetchInterval: 12_000,
  });
  const words = (data?.items ?? []).slice(0, 8);

  // Animate only freshly-seen claims (not the whole list on every poll).
  const seen = useRef<Set<string>>(new Set());
  const primed = useRef(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    if (!primed.current) {
      words.forEach((w) => seen.current.add(w.tokenId));
      primed.current = true;
      return;
    }
    const f = new Set<string>();
    words.forEach((w) => {
      if (!seen.current.has(w.tokenId)) {
        f.add(w.tokenId);
        seen.current.add(w.tokenId);
      }
    });
    if (f.size) setFresh(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <section aria-label="Recently claimed">
      <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-medium text-muted">
        Just claimed <LiveBadge />
      </h2>
      {isLoading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-5 w-40" />
            </div>
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load the feed." onRetry={() => void refetch()} />
      ) : words.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No words claimed yet. Be the first.</Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {words.map((w) => (
            <Link
              key={w.tokenId}
              to={`/word/${encodeURIComponent(w.word)}`}
              className={`flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-surface-2 ${
                fresh.has(w.tokenId) ? "row-enter" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span className="word-display truncate text-base">{w.word}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-faint">gone</span>
              </span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-muted">
                <UserBadge address={w.owner} size={18} link={false} textClassName="text-xs" />
                <span className="tabular-nums text-faint">{timeAgo(w.claimedAt)}</span>
              </span>
            </Link>
          ))}
        </Card>
      )}
    </section>
  );
}

/** Words currently on the secondary market — a live resale market forming, real /market data. */
function ForSale() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["market"],
    queryFn: api.market,
    retry: 1,
    refetchInterval: 15_000,
  });
  const listings = (data ?? []).slice(0, 8);

  return (
    <section aria-label="For sale">
      <h2 className="mb-3 font-display text-sm font-medium text-muted">For sale</h2>
      {isLoading ? (
        <Card className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="px-4 py-3">
              <Skeleton className="h-5 w-40" />
            </div>
          ))}
        </Card>
      ) : isError ? (
        <ErrorState message="Couldn’t load listings." onRetry={() => void refetch()} />
      ) : listings.length === 0 ? (
        <Card className="p-5 text-sm text-muted">No words listed for resale yet.</Card>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {listings.map((l) => (
            <Link
              key={l.tokenId}
              to={`/word/${encodeURIComponent(l.word)}`}
              className="flex items-center justify-between gap-2 px-4 py-3 transition hover:bg-surface-2"
            >
              <span className="word-display truncate text-base">{l.word}</span>
              <span className="shrink-0 text-sm font-medium tabular-nums">{ethLabel(l.price)}</span>
            </Link>
          ))}
        </Card>
      )}
    </section>
  );
}
