import { formatEther, formatUnits } from "viem";

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

/** Format wei (decimal string or bigint) as a readable ETH amount with dot decimals. */
export function formatEthAmount(wei: string | bigint): string {
  const v = toWei(wei) ?? 0n;
  const s = formatEther(v); // full-precision decimal string (no float involved)
  if (!s.includes(".")) return groupThousands(s);

  const [int, frac] = s.split(".");
  let out: string;
  if (int !== "0") {
    // >= 1 ETH: 4 decimals is plenty.
    out = `${groupThousands(int)}.${frac.slice(0, 4)}`;
  } else {
    // < 1 ETH: keep ~4 significant digits past the leading zeros, so both 0.5535 and a
    // tiny token price like 0.0000000019 stay readable without dumping 18 decimals.
    const lead = frac.match(/^0*/)?.[0].length ?? 0;
    out = `0.${frac.slice(0, Math.min(frac.length, lead + 4))}`;
  }
  return out.includes(".") ? out.replace(/\.?0+$/, "") : out;
}

function groupThousands(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function ethLabel(wei: string | bigint): string {
  return `${formatEthAmount(wei)} ETH`;
}

/**
 * Format a token base-unit amount (string or bigint, 18 decimals) as a trimmed,
 * human-readable number. Mirrors formatEthAmount's trimming so token counts read
 * cleanly (e.g. "1,234.5") without locale/precision pitfalls — we group thousands
 * on the integer part only and never touch the BigInt-derived fractional digits.
 */
export function formatTokens(amount: string | bigint, decimals = 18): string {
  const v = toWei(amount) ?? 0n;
  const s = formatUnits(v, decimals);
  const [int, rawFrac = ""] = s.split(".");
  // Display-only: token amounts are typically large, so cap fractional digits by
  // magnitude (none once we're into the thousands) instead of dumping all 18.
  const intDigits = int.replace(/^0$/, "").length;
  const maxFrac = intDigits >= 4 ? 0 : 4;
  const frac = rawFrac.slice(0, maxFrac).replace(/0+$/, "");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac}` : grouped;
}

/** Token amount with its symbol suffix, e.g. "1,234.5 BREAD". */
export function tokenLabel(amount: string | bigint, symbol?: string | null): string {
  const n = formatTokens(amount);
  return symbol ? `${n} ${symbol}` : n;
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
