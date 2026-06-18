import { useState } from "react";
import { useAccount } from "wagmi";
import { useWatchlist, useToggleWatch } from "../hooks/useWatchlist";
import { useToast } from "./Toast";
import { Spinner } from "./ui";
import { friendlyError } from "../lib/format";

/**
 * Per-word star/watch toggle. Signs watchlistMessage on toggle. Shows filled when
 * the connected user already watches this tokenId. Hidden when not connected.
 */
export function WatchButton({ tokenId }: { tokenId: string }) {
  const { address, isConnected } = useAccount();
  const { data: watched } = useWatchlist(address);
  const toggle = useToggleWatch();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  if (!isConnected || !address) return null;

  const isWatched = (watched ?? []).some((w) => w.tokenId === tokenId);

  async function onClick() {
    setBusy(true);
    try {
      await toggle(tokenId, !isWatched);
      toast.success(isWatched ? "Removed from watchlist" : "Added to watchlist");
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      aria-pressed={isWatched}
      aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm transition hover:bg-surface-2 disabled:opacity-50"
    >
      {busy ? (
        <Spinner />
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill={isWatched ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          className={isWatched ? "text-warning" : "text-muted"}
          aria-hidden
        >
          <path d="m12 17.27 6.18 3.73-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
        </svg>
      )}
      <span className="hidden sm:inline">{isWatched ? "Watching" : "Watch"}</span>
    </button>
  );
}
