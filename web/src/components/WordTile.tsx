import { Link } from "react-router-dom";
import { Card, Pill } from "./ui";
import { UserBadge } from "./UserBadge";
import { ethLabel } from "../lib/format";

interface WordTileProps {
  word: string;
  owner?: string | null;
  price?: string | null;
  footer?: string;
}

export function WordTile({ word, owner, price, footer }: WordTileProps) {
  return (
    <Link to={`/word/${encodeURIComponent(word)}`} className="group block">
      <Card className="flex h-full flex-col justify-between p-5 transition group-hover:border-fg/30">
        <div className="word-display text-2xl sm:text-3xl">{word}</div>
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
