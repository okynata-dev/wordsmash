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
  footer?: string;
}

export function WordTile({ word, owner, price, tokenPrice, marketCap, footer }: WordTileProps) {
  return (
    <Link to={`/word/${encodeURIComponent(word)}`} className="group block">
      <Card className="flex h-full flex-col justify-between p-5 transition group-hover:border-fg/30">
        <div className="word-display text-2xl sm:text-3xl">{word}</div>
        {tokenPrice || marketCap ? (
          <div className="mt-2 flex items-center gap-2 text-xs tabular-nums text-muted">
            {tokenPrice ? <span>{ethLabel(tokenPrice)}</span> : null}
            {marketCap ? <Pill tone="positive">{ethLabel(marketCap)} mcap</Pill> : null}
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
