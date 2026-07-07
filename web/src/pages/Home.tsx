import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  useAccount,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { normalizeWord } from "@shared/normalize";
import { api } from "../api";
import { registryAddress, wordRegistryAbi } from "../contracts";
import { activeChain } from "../wagmi";
import { useReceiptError } from "../hooks/useReceiptError";
import { Button, Card, Spinner, Pill, Skeleton, ErrorState } from "../components/ui";
import { WhitelistGate } from "../components/WhitelistGate";
import { useConnectModal } from "../components/ConnectModal";
import { WalletButton } from "../components/WalletButton";
import { LiveBadge } from "../components/ActivityFeed";
import { HowStrip } from "../components/HowStrip";
import { DiscoveryBoard } from "../components/DiscoveryBoard";
import { UserBadge } from "../components/UserBadge";
import { useToast } from "../components/Toast";
import { friendlyError, ethLabel, timeAgo } from "../lib/format";
import { useSyncAfterTx } from "../hooks/useSyncAfterTx";
import { keccak256, encodePacked } from "viem";
import {
  useClaimFee,
  useRemainingClaims,
  useWrongNetwork,
  useWhitelistEnabled,
  useIsAllowed,
  useCommitReveal,
} from "../hooks/useRegistry";

type State =
  | { kind: "idle" }
  | { kind: "invalid"; reason: string }
  | { kind: "checking"; normalized: string }
  | { kind: "available"; normalized: string }
  | { kind: "taken"; normalized: string };

// ── commit-reveal persistence ────────────────────────────────────────────────
// A commit costs gas and the reveal must follow within the on-chain COMMIT_MAX_AGE.
// The salt lives ONLY in the browser, so a refresh/navigation mid-countdown used to
// orphan the commit (gas burned, word unclaimable, a window opened for a sniper).
// Persist {word, salt, revealAt, address} in sessionStorage so the countdown resumes.
const COMMIT_STORE_PREFIX = "keepney.commit.";
const COMMIT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the contract's COMMIT_MAX_AGE (1 day)

interface StoredCommit {
  word: string;
  salt: `0x${string}`;
  revealAt: number;
  address: string;
}

function loadCommit(addr?: string): StoredCommit | null {
  if (!addr) return null;
  try {
    const raw = sessionStorage.getItem(COMMIT_STORE_PREFIX + addr.toLowerCase());
    return raw ? (JSON.parse(raw) as StoredCommit) : null;
  } catch {
    return null;
  }
}

function saveCommit(v: StoredCommit): void {
  try {
    sessionStorage.setItem(COMMIT_STORE_PREFIX + v.address.toLowerCase(), JSON.stringify(v));
  } catch {
    /* ignore quota/availability */
  }
}

function clearCommit(addr?: string): void {
  if (!addr) return;
  try {
    sessionStorage.removeItem(COMMIT_STORE_PREFIX + addr.toLowerCase());
  } catch {
    /* ignore */
  }
}

export function Home() {
  const [raw, setRaw] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const toast = useToast();

  // Deep-link from a word page's "Claim it": /?claim=<word> pre-fills the input and
  // focuses it, so the user is one tap from keeping the word they were just looking at.
  useEffect(() => {
    const w = searchParams.get("claim");
    if (!w) return;
    setRaw(w);
    window.setTimeout(() => document.getElementById("claim-word-input")?.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // The BUTTON path is whitelist-gated by <WhitelistGate>; the Enter-key path must
  // apply the same rule or a non-allowlisted wallet can fire a doomed claim tx.
  const { data: whitelistEnabled } = useWhitelistEnabled();
  const { data: allowed } = useIsAllowed(address);
  const whitelistClear = whitelistEnabled === false || allowed === true;
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
  const claimReceipt = useWaitForTransactionReceipt({ hash });
  const { isLoading: confirming, isSuccess } = claimReceipt;
  useReceiptError(claimReceipt, "The claim");

  // ── snipe-proof claims (commit → wait → reveal), active when the contract flag is on ──
  const { enabled: crEnabled, minDelaySec } = useCommitReveal();
  const commitWrite = useWriteContract();
  const commitReceipt = useWaitForTransactionReceipt({ hash: commitWrite.data });
  useReceiptError(commitReceipt, "The claim reservation");
  const saltRef = useRef<`0x${string}` | null>(null);
  // The address the commitment was bound to — the reveal must fire from THIS address
  // (the on-chain commitment = keccak(word, committer, salt)), so a mid-countdown
  // account switch must not auto-send a doomed reveal from the new address.
  const committedAddrRef = useRef<string | null>(null);
  const [revealAt, setRevealAt] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);

  function startCommit(word: string) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const salt = ("0x" +
      Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as `0x${string}`;
    saltRef.current = salt;
    claimingWordRef.current = word;
    committedAddrRef.current = (address as string).toLowerCase();
    // commitment binds (word, OUR address, salt) — copying it does a sniper no good
    const commitment = keccak256(
      encodePacked(["string", "address", "bytes32"], [word, address as `0x${string}`, salt]),
    );
    commitWrite.writeContract(
      {
        address: registryAddress,
        abi: wordRegistryAbi,
        functionName: "commitClaim",
        args: [commitment],
        chainId: activeChain.id,
      },
      {
        onError: (e) => {
          claimingWordRef.current = null;
          saltRef.current = null;
          toast.error(friendlyError(e));
        },
        onSuccess: () => toast.info("Reserving your claim…"),
      },
    );
  }

  // Commit confirmed -> arm the countdown (small buffer over the on-chain min delay)
  // and persist it so a refresh/navigation during the countdown can resume the reveal.
  useEffect(() => {
    if (commitReceipt.isSuccess) {
      const at = Date.now() + (minDelaySec + 2) * 1000;
      setRevealAt(at);
      if (address && saltRef.current && claimingWordRef.current) {
        saveCommit({
          word: claimingWordRef.current,
          salt: saltRef.current,
          revealAt: at,
          address: (address as string).toLowerCase(),
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitReceipt.isSuccess]);

  // On mount / account change: resume a pending commit for this address if one was
  // persisted and is still within the on-chain reveal window.
  useEffect(() => {
    if (!address || revealAt !== null || commitWrite.isPending || commitReceipt.isLoading) return;
    const v = loadCommit(address);
    if (!v) return;
    if (Date.now() > v.revealAt + COMMIT_MAX_AGE_MS) {
      clearCommit(address); // too old to reveal on-chain anymore
      return;
    }
    saltRef.current = v.salt;
    claimingWordRef.current = v.word;
    committedAddrRef.current = v.address.toLowerCase();
    setRaw(v.word);
    setRevealAt(v.revealAt); // arms the countdown/auto-reveal effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  // Tick down, then auto-send the reveal — one tap for the user, two txs under the hood.
  useEffect(() => {
    if (revealAt === null) return;
    const t = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((revealAt - Date.now()) / 1000));
      setCountdown(left);
      if (left > 0) return;
      window.clearInterval(t);
      setRevealAt(null);
      const w = claimingWordRef.current;
      const salt = saltRef.current;
      if (!w || !salt) return;
      // The reveal must fire from the address the commitment was bound to. If the
      // user switched accounts mid-countdown, don't broadcast a doomed reveal from
      // the wrong address — pause and keep the persisted commit for when they switch back.
      if (!address || (address as string).toLowerCase() !== committedAddrRef.current) {
        toast.error("Switch back to the wallet that reserved this word to finish the claim.");
        return;
      }
      writeContract(
        {
          address: registryAddress,
          abi: wordRegistryAbi,
          functionName: "claimWithCommit",
          args: [w, salt],
          value: (claimFee as bigint | undefined) ?? 0n,
          chainId: activeChain.id,
        },
        {
          onError: (e) => {
            claimingWordRef.current = null;
            saltRef.current = null;
            clearCommit(committedAddrRef.current ?? undefined);
            toast.error(friendlyError(e));
          },
          onSuccess: () => toast.info("Claiming… confirm in your wallet"),
        },
      );
    }, 250);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealAt]);

  const committing =
    commitWrite.isPending || commitReceipt.isLoading || revealAt !== null;

  // The exact word being claimed, captured at click time so navigation never depends
  // on the live input state (which re-checks and can change out from under us).
  const claimingWordRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isSuccess) return;
    const w = claimingWordRef.current ?? ("normalized" in state ? state.normalized : raw);
    if (!w) return;
    fireSmash(); // celebration burst the moment the claim lands
    toast.success(`Kept "${w}"`);
    clearCommit(committedAddrRef.current ?? address); // consumed — drop the persisted commit
    void refetchRemaining();
    // Prime caches to ride out indexer lag, then ALWAYS land on the word's page so
    // the user sees their new token + can trade it. Navigation must not hinge on the
    // sync resolving — a rejected/slow sync used to strand the user on the home page.
    sync([["stats"], ["activity"], ["word", w]], { attempts: 2, intervalMs: 1200 })
      .catch(() => {})
      .finally(() => {
        claimingWordRef.current = null;
        reset();
        navigate(`/word/${encodeURIComponent(w)}`);
      });
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
    if (crEnabled) {
      startCommit(state.normalized); // snipe-proof path: commit now, reveal after the delay
      return;
    }
    claimingWordRef.current = state.normalized; // remember what we're claiming for post-tx nav
    writeContract(
      {
        address: registryAddress,
        abi: wordRegistryAbi,
        functionName: "claim",
        args: [state.normalized],
        value: (claimFee as bigint | undefined) ?? 0n,
        chainId: activeChain.id,
      },
      {
        onError: (e) => {
          claimingWordRef.current = null;
          toast.error(friendlyError(e));
        },
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
          committing ||
          outOfClaims ||
          claimFee === undefined /* M3/M4: never enable a claim before the fee is known */
        }
      >
        {committing ? (
          <>
            <Spinner />{" "}
            {revealAt !== null ? `Securing your claim… ${countdown}s` : "Reserving…"}
          </>
        ) : isPending || confirming || syncing ? (
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
          Keep a <span className="text-volt">word</span>.
        </h1>
        <p className="mt-2 text-[15px] text-muted">
          Every word gets its own token. You earn on every trade.
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
                  whitelistClear &&
                  !outOfClaims &&
                  claimFee !== undefined &&
                  !isPending &&
                  !confirming &&
                  !syncing &&
                  !committing
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

      {/* The money loop in one glance. */}
      <HowStrip />

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
