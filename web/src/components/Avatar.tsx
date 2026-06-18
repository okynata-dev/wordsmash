import { useState } from "react";
import { generatedAvatar } from "@shared/social";
import { avatarUrl } from "../api";
import { normAddr } from "../lib/format";

/**
 * User avatar. Tries the server avatar (GET /avatar/:address, which itself falls
 * back to a generated gradient); if that image fails to load we render the
 * client-side generatedAvatar() so there is never a broken-image icon.
 * Words/deeds are intentionally imageless — only users get avatars.
 */
export function Avatar({
  address,
  size = 40,
  className = "",
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const fallback = generatedAvatar(address, size);
  const [src, setSrc] = useState(() => avatarUrl(address));
  return (
    <img
      src={src}
      onError={() => {
        if (src !== fallback) setSrc(fallback);
      }}
      width={size}
      height={size}
      alt=""
      aria-hidden
      loading="lazy"
      style={{ width: size, height: size }}
      className={`shrink-0 rounded-full bg-surface-2 object-cover ${className}`}
      key={normAddr(address)}
    />
  );
}
