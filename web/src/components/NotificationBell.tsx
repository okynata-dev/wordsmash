// Notification bell — events that touched YOUR words/deeds (someone trading a
// word you hold the deed of; your deed sold/bought). All indexer-derived; the
// unread count is client-side (localStorage watermark of the newest-seen ts).
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import type { NotificationRow } from "@shared/types";
import { api } from "../api";
import { ethLabel, shortAddr, timeAgo, normAddr } from "../lib/format";
import { Spinner } from "./ui";

function seenKey(addr: string) {
  return `keepney.notifSeen.${addr.toLowerCase()}`;
}

function describe(n: NotificationRow): string {
  const who = shortAddr(n.actor);
  if (n.kind === "trade_on_your_word") {
    return `${who} ${n.isBuy ? "bought" : "sold"} $${n.word.toUpperCase()} — you earned fees`;
  }
  if (n.kind === "your_deed_sold") return `You sold the deed “${n.word}” for ${ethLabel(n.amountWei)}`;
  return `You bought the deed “${n.word}” for ${ethLabel(n.amountWei)}`;
}

export function NotificationBell() {
  const { address, isConnected } = useAccount();
  const [open, setOpen] = useState(false);
  const [seenTs, setSeenTs] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["notifications", address?.toLowerCase()],
    queryFn: () => api.notifications(address!),
    enabled: Boolean(address),
    retry: 1,
    refetchInterval: 30_000,
  });
  const rows = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Load the last-seen watermark once we know the address.
  useEffect(() => {
    if (!address) return;
    try {
      setSeenTs(Number(localStorage.getItem(seenKey(address)) ?? "0") || 0);
    } catch {
      setSeenTs(0);
    }
  }, [address]);

  const unread = rows.filter((n) => n.ts > seenTs).length;

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!isConnected || !address) return null;

  function toggle() {
    const next = !open;
    setOpen(next);
    // Opening marks everything up to the newest as read.
    if (next && rows.length > 0) {
      const newest = rows[0].ts;
      setSeenTs(newest);
      try {
        localStorage.setItem(seenKey(address!), String(newest));
      } catch {
        /* private mode — unread just won't persist */
      }
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications (${unread} new)` : "Notifications"}
        className="relative rounded-md p-2 text-muted transition hover:bg-surface-2 hover:text-fg"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[rgb(var(--c-volt))] px-1 text-[10px] font-bold leading-none text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          <div className="border-b border-border px-4 py-2.5 text-sm font-medium">Notifications</div>
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted">
                <Spinner /> Loading…
              </div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted">
                Nothing yet. Activity on your words shows up here.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {rows.map((n) => (
                  <li key={`${n.tx}-${n.ts}-${n.kind}`}>
                    <Link
                      to={`/word/${encodeURIComponent(n.word)}`}
                      onClick={() => setOpen(false)}
                      className="flex items-start gap-2 px-4 py-3 transition hover:bg-surface-2"
                    >
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.ts > seenTs ? "bg-[rgb(var(--c-volt))]" : "bg-transparent"}`} />
                      <span className="min-w-0">
                        <span className="block text-sm leading-snug text-fg">{describe(n)}</span>
                        <span className="text-xs text-faint">{timeAgo(n.ts)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link
            to={`/profile/${normAddr(address)}`}
            onClick={() => setOpen(false)}
            className="block border-t border-border px-4 py-2.5 text-center text-xs text-muted transition hover:text-fg"
          >
            View your profile
          </Link>
        </div>
      )}
    </div>
  );
}
