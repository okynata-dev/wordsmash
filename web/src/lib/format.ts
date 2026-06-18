import { formatEther } from "viem";

/** Short address: 0x1234…abcd */
export function shortAddr(addr?: string | null): string {
  if (!addr) return "—";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Lowercase an address for use as a stable query/Map key or API path segment.
 * Avoids cache fragmentation / double-counting from mixed-case checksummed addresses.
 * Returns "" for nullish input.
 */
export function normAddr(addr?: string | null): string {
  if (!addr) return "";
  return addr.trim().toLowerCase();
}

/**
 * Safely coerce a wei value (decimal string or bigint) to bigint.
 * Returns null on any malformed input instead of throwing.
 */
export function toWei(wei: string | bigint | null | undefined): bigint | null {
  if (wei === null || wei === undefined) return null;
  if (typeof wei === "bigint") return wei;
  try {
    const s = String(wei).trim();
    if (s === "") return null;
    // BigInt() accepts decimal/hex strings; reject anything with a fractional part.
    if (!/^-?\d+$/.test(s) && !/^0x[0-9a-fA-F]+$/.test(s)) return null;
    return BigInt(s);
  } catch {
    return null;
  }
}

/** Format wei (decimal string or bigint) as a trimmed ETH amount with dot decimals. */
export function formatEthAmount(wei: string | bigint): string {
  const v = toWei(wei) ?? 0n;
  const s = formatEther(v);
  // Trim trailing zeros but keep at least one decimal place when fractional.
  if (s.includes(".")) {
    return s.replace(/\.?0+$/, "");
  }
  return s;
}

export function ethLabel(wei: string | bigint): string {
  return `${formatEthAmount(wei)} ETH`;
}

/** Relative time from a unix-seconds timestamp. */
export function timeAgo(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "—";
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return "just now";
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Friendly message from a viem/wagmi error. */
export function friendlyError(err: unknown): string {
  if (!err) return "Something went wrong.";
  const e = err as { shortMessage?: string; message?: string };
  return e.shortMessage ?? e.message ?? String(err);
}
