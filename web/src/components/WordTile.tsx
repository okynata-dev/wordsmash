import { Link } from "react-router-dom";
import { Card, Pill } from "./ui";
import { UserBadge } from "./UserBadge";
import { ethLabel } from "../lib/format";

interface WordTileProps {
  word: string;
  owner?: string | null;
  /** Listing/sale price in wei (deed market). */
  price?: string | null;
  /** Token-market spot price in wei (v2 coin). */
  tokenPrice?: string | null;
  /** Token-market cap in wei (v2 coin). */
  marketCap?: string | null;
  /** Graduation progress, 0..10000 bps (from /words rows once a market exists). */
  graduationProgressBps?: number | null;
  /** Whether the token market has graduated. */
  graduated?: boolean | null;
  /** Claim time (unix seconds); used to flag recently-claimed words as "new". */
  claimedAt?: number | null;
  footer?: string;
}

/** Words claimed within this many seconds get a "new" badge. */
const NEW_WINDOW_SECONDS = 5 * 60;

export function WordTile({
  word,
  owner,
  price,
  tokenPrice,
  marketCap,
  graduationProgressBps,
  graduated,
  claimedAt,
  footer,
}: WordTileProps) {
  const isNew =
    typeof claimedAt === "number" && claimedAt > 0 && Date.now() / 1000 - claimedAt < NEW_WINDOW_SECONDS;

  // Clamp + scale the bps into a percentage for the bar.
  const pct =
    typeof graduationProgressBps === "number"
      ? Math.max(0, Math.min(100, graduationProgressBps / 100))
      : null;
  const showBar = !graduated && pct !== null;
  // A never-traded market reports a "0" price; treat that as "no trades yet", not "0 ETH".
  const hasTokenPrice = tokenPrice != null && tokenPrice !== "0";
  const hasMarketCap = marketCap != null && marketCap !== "0";

  return (
    <Link to={`/word/${encodeURIComponent(word)}`} className="group block">
      <Card className="flex h-full flex-col justify-between p-5 transition duration-150 group-hover:-translate-y-0.5 group-hover:border-fg/30 group-hover:shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="word-display text-2xl sm:text-3xl">{word}</div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {graduated ? (
              <Pill tone="warning">graduated 🎓</Pill>
            ) : isNew ? (
              <Pill tone="positive">new</Pill>
            ) : null}
          </div>
        </div>

        {hasTokenPrice || hasMarketCap ? (
          <div className="mt-2 flex items-center gap-2 text-xs tabular-nums text-muted">
            {hasTokenPrice ? <span>{ethLabel(tokenPrice!)}</span> : null}
            {hasMarketCap ? <Pill tone="positive">{ethLabel(marketCap!)} mcap</Pill> : null}
          </div>
        ) : (
          tokenPrice != null ? <div className="mt-2 text-xs text-faint">no trades yet</div> : null
        )}

        {showBar ? (
          <div className="mt-3" title={`${pct!.toFixed(0)}% to graduation`}>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-faint">
              <span>graduation</span>
              <span className="tabular-nums">{pct!.toFixed(0)}%</span>
            </div>
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuenow={Math.round(pct!)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Graduation progress"
            >
              <div
                className="h-full rounded-full bg-positive transition-[width] duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted">
          {owner ? (
            <UserBadge address={owner} size={18} link={false} textClassName="text-xs" />
          ) : (
            <span>{footer ?? ""}</span>
          )}
          {price ? <Pill tone="positive">{ethLabel(price)}</Pill> : null}
        </div>
      </Card>
    </Link>
  );
}
