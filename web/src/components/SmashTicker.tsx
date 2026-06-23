import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api";
import { ethLabel, shortAddr } from "../lib/format";
import type { ActivityRow } from "@shared/types";

const VERB: Record<ActivityRow["type"], string> = {
  claim: "claimed",
  list: "listed",
  cancel: "unlisted",
  sale: "sold",
  transfer: "moved",
  buy: "bought",
  sell: "sold",
};

function tone(t: ActivityRow["type"]): string {
  if (t === "buy") return "text-positive";
  if (t === "sell" || t === "cancel") return "text-negative";
  if (t === "claim") return "text-fg";
  return "text-muted";
}

function dot(t: ActivityRow["type"]): string {
  if (t === "buy") return "bg-positive";
  if (t === "sell" || t === "cancel") return "bg-negative";
  if (t === "claim") return "bg-fg";
  return "bg-faint";
}

/**
 * The "smash ticker" — a thin, always-moving strip of REAL recent activity
 * (claims + token buys/sells + listings + graduations pooled into one stream so
 * even sparse beta data reads as alive). Strict, monochrome + one green/pink
 * accent pair, typographic — energy in the data, not a flashing casino. Hidden
 * entirely when there's no activity (no fake/ghost events).
 */
export function SmashTicker() {
  const { data } = useQuery({
    queryKey: ["activity", "ticker"],
    queryFn: api.activity,
    retry: 1,
    refetchInterval: 5_000,
  });

  const rows = (data ?? []).slice(0, 24);
  if (rows.length === 0) return null;

  // Duplicate so the marquee loops seamlessly at -50%.
  const loop = [...rows, ...rows];

  return (
    <div
      className="overflow-hidden border-b border-border bg-bg"
      aria-label="Live activity ticker"
    >
      <div className="ticker flex w-max items-center gap-7 whitespace-nowrap py-1.5 text-[13px]">
        {loop.map((a, i) => (
          <Link
            key={i}
            to={`/word/${encodeURIComponent(a.word)}`}
            className="flex items-center gap-1.5"
            aria-hidden={i >= rows.length}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot(a.type)}`} />
            <span className="text-faint">{shortAddr(a.address)}</span>
            <span className={tone(a.type)}>{VERB[a.type]}</span>
            <span className="font-medium text-fg">{a.word}</span>
            {a.price && a.price !== "0" ? (
              <span className="tabular-nums text-faint">{ethLabel(a.price)}</span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
