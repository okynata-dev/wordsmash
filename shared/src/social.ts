// Off-chain social layer (profiles, comments, watchlist) — types, validation, and the canonical
// signed-message builders. Writes are authorized with a wallet signature (SIWE-lite): the client
// signs a message built here, the indexer rebuilds the SAME message and recovers the signer.
// Frontend and indexer MUST both import these builders so the bytes match exactly.

export interface ProfileMeta {
  address: string; // checksummed
  username: string | null; // unique, [a-z0-9_], 3-20
  bio: string | null; // <= 280, no newlines
  avatarUrl: string | null; // R2 url; null => use generated /avatar/:address
  twitterHandle: string | null; // self-attested handle without leading @
  twitterVerified: boolean; // true only after real OAuth (HUMAN TASK)
  website: string | null;
  updatedAt: number | null;
}

export interface ProfileEditable {
  username?: string | null;
  bio?: string | null;
  twitterHandle?: string | null;
  website?: string | null;
}

export interface Comment {
  id: number;
  tokenId: string;
  word: string;
  author: string; // checksummed
  authorMeta?: Pick<ProfileMeta, "username" | "avatarUrl">;
  body: string;
  ts: number;
}

export interface SignedRequest {
  address: string;
  timestamp: number; // unix ms
  signature: `0x${string}`;
}

export const SIG_TTL_MS = 10 * 60 * 1000; // signed requests valid for 10 minutes

// ── validation ────────────────────────────────────────────────────────────────
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/;
export const BIO_MAX = 280;
export const COMMENT_MAX = 500;

export function normalizeUsername(input: string | null | undefined): string | null {
  if (input == null) return null;
  const u = input.trim().toLowerCase();
  return u === "" ? null : u;
}

export function validateUsername(u: string | null): string | null {
  if (u === null) return null; // clearing is allowed
  return USERNAME_RE.test(u) ? null : "username must be 3–20 chars of a–z, 0–9, _";
}

export function sanitizeBio(input: string | null | undefined): string | null {
  if (input == null) return null;
  const b = input.replace(/\s+/g, " ").trim().slice(0, BIO_MAX);
  return b === "" ? null : b;
}

export function normalizeTwitter(input: string | null | undefined): string | null {
  if (input == null) return null;
  const h = input.trim().replace(/^@+/, "").replace(/^https?:\/\/(x|twitter)\.com\//i, "");
  if (h === "") return null;
  return /^[A-Za-z0-9_]{1,15}$/.test(h) ? h : null;
}

export function normalizeWebsite(input: string | null | undefined): string | null {
  if (input == null) return null;
  let w = input.trim();
  if (w === "") return null;
  if (!/^https?:\/\//i.test(w)) w = `https://${w}`;
  try {
    const u = new URL(w);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

// ── canonical signed messages (identical on client + server) ──────────────────
export function profileUpdateMessage(address: string, p: ProfileEditable, timestamp: number): string {
  return [
    "wordsmash: update profile",
    `address: ${address.toLowerCase()}`,
    `username: ${JSON.stringify(p.username ?? null)}`,
    `bio: ${JSON.stringify(p.bio ?? null)}`,
    `twitter: ${JSON.stringify(p.twitterHandle ?? null)}`,
    `website: ${JSON.stringify(p.website ?? null)}`,
    `issued: ${timestamp}`,
  ].join("\n");
}

export function avatarUploadMessage(address: string, timestamp: number): string {
  return `wordsmash: upload avatar\naddress: ${address.toLowerCase()}\nissued: ${timestamp}`;
}

export function commentMessage(address: string, word: string, body: string, timestamp: number): string {
  return [
    "wordsmash: post comment",
    `address: ${address.toLowerCase()}`,
    `word: ${word}`,
    `body: ${JSON.stringify(body)}`,
    `issued: ${timestamp}`,
  ].join("\n");
}

export function watchlistMessage(address: string, tokenId: string, on: boolean, timestamp: number): string {
  return [
    "wordsmash: toggle watchlist",
    `address: ${address.toLowerCase()}`,
    `token: ${tokenId}`,
    `on: ${on}`,
    `issued: ${timestamp}`,
  ].join("\n");
}

/** Deterministic gradient avatar (data-URI SVG) from an address — the default when none uploaded. */
export function generatedAvatar(address: string, size = 64): string {
  const a = address.toLowerCase().replace(/^0x/, "");
  const h = (s: number) => parseInt(a.slice(s, s + 6) || "0", 16) % 360;
  const h1 = h(0);
  const h2 = (h(6) + 120) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${h1} 70% 55%)"/>` +
    `<stop offset="1" stop-color="hsl(${h2} 70% 45%)"/>` +
    `</linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
