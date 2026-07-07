import { Link } from "react-router-dom";
import { Avatar } from "./Avatar";
import { useProfileMeta } from "../hooks/useProfile";
import { shortAddr, normAddr } from "../lib/format";

/**
 * Compact identity chip used everywhere an address would otherwise appear:
 * leaderboard owners, listings "by …", ownership history, comments, activity.
 * Shows the avatar + username (or short address) and links to the profile.
 */
export function UserBadge({
  address,
  size = 24,
  className = "",
  showAvatar = true,
  link = true,
  textClassName = "text-sm",
}: {
  address: string;
  size?: number;
  className?: string;
  showAvatar?: boolean;
  link?: boolean;
  textClassName?: string;
}) {
  const { data: meta } = useProfileMeta(address);
  const label = meta?.username ? `@${meta.username}` : shortAddr(address);

  const inner = (
    <span className={`inline-flex min-w-0 items-center gap-1.5 align-middle ${className}`}>
      {showAvatar && <Avatar address={address} size={size} />}
      <span className={`truncate leading-none ${textClassName}`}>{label}</span>
    </span>
  );

  if (!link) return inner;

  return (
    <Link
      to={`/profile/${normAddr(address)}`}
      className="inline-flex min-w-0 items-center rounded-md text-fg/90 transition hover:text-fg"
      title={address}
    >
      {inner}
    </Link>
  );
}
