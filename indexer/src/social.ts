// Off-chain social layer handlers: profiles, avatars, comments, watchlist, search,
// global activity. Writes are authorized SIWE-lite: the client signs a message built
// by the SHARED builders (shared/src/social.ts); we rebuild the SAME message and
// recover the signer. All address output is checksummed via viem getAddress.

import { getAddress, isAddress, recoverMessageAddress } from "viem";
import type { Db } from "./db.js";
import { normalizeWord } from "../../shared/src/normalize.js";
import {
  SIG_TTL_MS,
  USERNAME_RE,
  COMMENT_MAX,
  normalizeUsername,
  validateUsername,
  sanitizeBio,
  normalizeTwitter,
  normalizeWebsite,
  profileUpdateMessage,
  avatarUploadMessage,
  commentMessage,
  watchlistMessage,
  generatedAvatar,
  type ProfileMeta,
  type Comment,
} from "../../shared/src/social.js";
import type {
  Profile,
  WordRow,
  ListingRow,
  ActivityRow,
  ActivityType,
  SearchResult,
  Paginated,
} from "../../shared/src/types.js";

// Marker error type so the router can map auth failures to 401.
export class AuthError extends Error {}
// Marker for client-input problems the router maps to a 4xx.
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const COMMENTS_PAGE = 30;
const ACTIVITY_PAGE = 30;
const SEARCH_LIMIT = 10;

function checksum(addr: string | null | undefined): string {
  if (!addr) return "";
  try {
    return getAddress(addr as `0x${string}`);
  } catch {
    return addr;
  }
}

/** Validate a path :address param, returning the lowercased form. Throws HttpError(400). */
export function requireAddress(raw: string): string {
  if (!isAddress(raw)) throw new HttpError(400, "invalid address");
  return raw.toLowerCase();
}

/**
 * Verify a SIWE-lite signed request: recover the signer of `message` and require it
 * to equal `address`, and require `timestamp` to be within SIG_TTL_MS of now.
 * Throws AuthError (-> 401) on any failure.
 */
export async function verifySigned(
  message: string,
  address: string,
  signature: `0x${string}`,
  timestamp: number,
): Promise<void> {
  if (!isAddress(address)) throw new AuthError("invalid address");
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    throw new AuthError("invalid timestamp");
  }
  const now = Date.now();
  // Reject far-future timestamps tightly (small clock-skew allowance) and stale ones past the TTL.
  if (timestamp > now + 60_000) throw new AuthError("timestamp in future");
  if (now - timestamp > SIG_TTL_MS) throw new AuthError("signature expired");
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature });
  } catch {
    throw new AuthError("bad signature");
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    throw new AuthError("signer mismatch");
  }
}

/**
 * Replay guard: consume a signature exactly once. A captured signed payload (same signature)
 * cannot be re-submitted. Call AFTER verifySigned (which TTL-bounds the timestamp). Old rows are
 * pruned opportunistically — a signature past the TTL is rejected by verifySigned anyway.
 */
export async function enforceFreshness(
  db: Db,
  signature: `0x${string}`,
  timestamp: number,
): Promise<void> {
  const seen = await db
    .prepare("SELECT 1 AS x FROM consumed_sigs WHERE sig = ?")
    .bind(signature)
    .first<{ x: number }>();
  if (seen) throw new AuthError("replayed request");
  await db
    .prepare("INSERT OR IGNORE INTO consumed_sigs (sig, ts) VALUES (?, ?)")
    .bind(signature, timestamp)
    .run();
  // prune signatures older than the TTL (they can never validate again)
  await db.prepare("DELETE FROM consumed_sigs WHERE ts < ?").bind(Date.now() - SIG_TTL_MS).run();
}

// ── profile read ────────────────────────────────────────────────────────────

interface ProfileDbRow {
  address: string;
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  twitter: string | null;
  twitter_verified: number;
  website: string | null;
  updated_at: number | null;
}

function defaultMeta(address: string): ProfileMeta {
  return {
    address: checksum(address),
    username: null,
    bio: null,
    avatarUrl: null,
    twitterHandle: null,
    twitterVerified: false,
    website: null,
    updatedAt: null,
  };
}

function rowToMeta(address: string, row: ProfileDbRow | null): ProfileMeta {
  if (!row) return defaultMeta(address);
  return {
    address: checksum(address),
    username: row.username,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    twitterHandle: row.twitter,
    twitterVerified: !!row.twitter_verified,
    website: row.website,
    updatedAt: row.updated_at == null ? null : Number(row.updated_at),
  };
}

async function profileRow(db: Db, address: string): Promise<ProfileDbRow | null> {
  return db
    .prepare(
      "SELECT address, username, bio, avatar_url, twitter, twitter_verified, website, updated_at FROM profiles WHERE address = ?",
    )
    .bind(address)
    .first<ProfileDbRow>();
}

function toWordRow(r: {
  token_id: string;
  word: string | null;
  owner: string;
  claimed_at: number;
  tx: string;
}): WordRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    owner: checksum(r.owner),
    claimedAt: Number(r.claimed_at ?? 0),
    tx: r.tx ?? "",
  };
}

function toListingRow(r: {
  token_id: string;
  word: string | null;
  price: string;
  seller: string;
  active: number;
}): ListingRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    price: r.price ?? "0",
    seller: checksum(r.seller),
    active: !!r.active,
  };
}

function toActivityRow(r: {
  address: string;
  type: string;
  token_id: string;
  word: string | null;
  counterparty: string | null;
  price: string | null;
  ts: number;
  tx: string;
}): ActivityRow {
  const row: ActivityRow = {
    address: checksum(r.address),
    type: r.type as ActivityType,
    tokenId: r.token_id,
    word: r.word ?? "",
    ts: Number(r.ts ?? 0),
    tx: r.tx ?? "",
  };
  if (r.counterparty) row.counterparty = checksum(r.counterparty);
  if (r.price != null) row.price = r.price;
  return row;
}

// GET /profile/:address — full Profile with meta + stats. (M1: capped owned/listings.)
const OWNED_CAP = 100;
const LISTINGS_CAP = 100;

export async function getProfile(db: Db, addressLower: string): Promise<Profile> {
  const address = addressLower;

  const { results: owned } = await db
    .prepare(
      "SELECT token_id, word, owner, claimed_at, tx FROM words WHERE owner = ? ORDER BY claimed_at DESC LIMIT ?",
    )
    .bind(address, OWNED_CAP)
    .all<{ token_id: string; word: string | null; owner: string; claimed_at: number; tx: string }>();

  const { results: listings } = await db
    .prepare(
      "SELECT token_id, word, price, seller, active FROM listings WHERE seller = ? AND active = 1 LIMIT ?",
    )
    .bind(address, LISTINGS_CAP)
    .all<{ token_id: string; word: string | null; price: string; seller: string; active: number }>();

  const { results: activity } = await db
    .prepare(
      "SELECT address, type, token_id, word, counterparty, price, ts, tx FROM activity WHERE address = ? ORDER BY ts DESC, id DESC LIMIT 100",
    )
    .bind(address)
    .all<{
      address: string;
      type: string;
      token_id: string;
      word: string | null;
      counterparty: string | null;
      price: string | null;
      ts: number;
      tx: string;
    }>();

  // stats: owned count + sum of that owner's words.volume_wei (BigInt -> string).
  const ownedCount = await db
    .prepare("SELECT COUNT(*) AS c FROM words WHERE owner = ?")
    .bind(address)
    .first<{ c: number }>();
  const { results: vols } = await db
    .prepare("SELECT volume_wei FROM words WHERE owner = ?")
    .bind(address)
    .all<{ volume_wei: string | null }>();
  let volumeWei = 0n;
  for (const v of vols) volumeWei += BigInt(v.volume_wei ?? "0");

  const meta = rowToMeta(address, await profileRow(db, address));

  return {
    address: checksum(address),
    meta,
    owned: owned.map(toWordRow),
    listings: listings.map(toListingRow),
    activity: activity.map(toActivityRow),
    stats: { owned: Number(ownedCount?.c ?? 0), volumeWei: volumeWei.toString() },
  };
}

// POST /profile/:address — update profile. Body: {username,bio,twitterHandle,website,timestamp,signature}
export async function updateProfile(
  db: Db,
  addressLower: string,
  body: {
    username?: string | null;
    bio?: string | null;
    twitterHandle?: string | null;
    website?: string | null;
    timestamp?: number;
    signature?: `0x${string}`;
  },
): Promise<ProfileMeta> {
  const address = addressLower;

  const username = normalizeUsername(body.username);
  const usernameErr = validateUsername(username);
  if (usernameErr) throw new HttpError(400, usernameErr);
  const bio = sanitizeBio(body.bio);
  const twitterHandle = normalizeTwitter(body.twitterHandle);
  const website = normalizeWebsite(body.website);

  // Reconstruct the EXACT signed message from the SHARED builder. We sign the
  // normalized values so the recovered signature matches what we persist.
  const timestamp = Number(body.timestamp);
  const message = profileUpdateMessage(
    address,
    { username, bio, twitterHandle, website },
    timestamp,
  );
  await verifySigned(message, address, body.signature as `0x${string}`, timestamp);
  await enforceFreshness(db, body.signature as `0x${string}`, timestamp);

  // Username uniqueness: reject if taken by a DIFFERENT address (409).
  if (username !== null) {
    const taken = await db
      .prepare("SELECT address FROM profiles WHERE username = ?")
      .bind(username)
      .first<{ address: string }>();
    if (taken && taken.address.toLowerCase() !== address) {
      throw new HttpError(409, "username taken");
    }
  }

  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO profiles (address, username, bio, avatar_url, twitter, twitter_verified, website, updated_at)
       VALUES (?, ?, ?, NULL, ?, 0, ?, ?)
       ON CONFLICT(address) DO UPDATE SET
         username = excluded.username,
         bio = excluded.bio,
         twitter = excluded.twitter,
         website = excluded.website,
         updated_at = excluded.updated_at`,
    )
    .bind(address, username, bio, twitterHandle, website, now)
    .run();

  return rowToMeta(address, await profileRow(db, address));
}

// Avatar upload — env may expose an R2 binding + PUBLIC_BASE.
export interface AvatarEnv {
  AVATARS?: { put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown> };
  PUBLIC_BASE?: string;
}

const AVATAR_MAX_BYTES = 200 * 1024;
const AVATAR_MIME_RE = /^data:image\/(png|jpeg|webp);base64,/i;
const AVATAR_MIME_RE_PLAIN = /^data:image\/(png|jpeg|webp)[;,]/i;

function decodeDataUrl(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }
  return new TextEncoder().encode(decodeURIComponent(payload));
}

// POST /profile/:address/avatar — body {dataUrl,timestamp,signature}
export async function uploadAvatar(
  db: Db,
  addressLower: string,
  body: { dataUrl?: string; timestamp?: number; signature?: `0x${string}` },
  env: AvatarEnv,
): Promise<{ avatarUrl: string }> {
  const address = addressLower;
  const timestamp = Number(body.timestamp);
  const message = avatarUploadMessage(address, timestamp);
  await verifySigned(message, address, body.signature as `0x${string}`, timestamp);
  await enforceFreshness(db, body.signature as `0x${string}`, timestamp);

  const dataUrl = body.dataUrl;
  if (typeof dataUrl !== "string" || !AVATAR_MIME_RE_PLAIN.test(dataUrl)) {
    throw new HttpError(400, "dataUrl must be data:image/(png|jpeg|webp)");
  }
  // Size check on the raw string is a fast bound; the decoded bytes are smaller.
  if (dataUrl.length > AVATAR_MAX_BYTES * 2 + 1024) {
    throw new HttpError(413, "avatar too large");
  }

  let avatarUrl: string;
  if (env.AVATARS) {
    const bytes = decodeDataUrl(dataUrl);
    if (bytes.byteLength > AVATAR_MAX_BYTES) throw new HttpError(413, "avatar too large");
    await env.AVATARS.put(address, bytes);
    const base = (env.PUBLIC_BASE ?? "").replace(/\/+$/, "");
    avatarUrl = `${base}/avatar/file/${address}`;
  } else {
    // Local-dev fallback: store the data URL directly.
    if (dataUrl.length > AVATAR_MAX_BYTES) throw new HttpError(413, "avatar too large");
    avatarUrl = dataUrl;
  }

  await db
    .prepare(
      `INSERT INTO profiles (address, avatar_url, twitter_verified, updated_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(address) DO UPDATE SET avatar_url = excluded.avatar_url, updated_at = excluded.updated_at`,
    )
    .bind(address, avatarUrl, Date.now())
    .run();

  return { avatarUrl };
}

/** Return the stored avatar_url for an address (or null). */
export async function getAvatarUrl(db: Db, addressLower: string): Promise<string | null> {
  const row = await profileRow(db, addressLower);
  return row?.avatar_url ?? null;
}

/** The generated default avatar SVG (raw markup, not a data URI) for serving. */
export function generatedAvatarSvg(address: string): string {
  const dataUri = generatedAvatar(address);
  const enc = dataUri.replace(/^data:image\/svg\+xml;utf8,/, "");
  return decodeURIComponent(enc);
}

// GET /u/:username -> {address}
export async function resolveUsername(
  db: Db,
  rawUsername: string,
): Promise<{ address: string } | null> {
  const u = normalizeUsername(rawUsername);
  if (!u || !USERNAME_RE.test(u)) return null;
  const row = await db
    .prepare("SELECT address FROM profiles WHERE username = ?")
    .bind(u)
    .first<{ address: string }>();
  return row ? { address: checksum(row.address) } : null;
}

// ── comments ──────────────────────────────────────────────────────────────

function normalizeWordParam(raw: string): string {
  const norm = normalizeWord(raw);
  return norm.ok ? norm.normalized : raw.toLowerCase();
}

function rowToComment(r: {
  id: number;
  token_id: string | null;
  word: string;
  author: string;
  body: string;
  ts: number;
  username: string | null;
  avatar_url: string | null;
}): Comment {
  const c: Comment = {
    id: Number(r.id),
    tokenId: r.token_id ?? "",
    word: r.word,
    author: checksum(r.author),
    body: r.body,
    ts: Number(r.ts),
  };
  if (r.username != null || r.avatar_url != null) {
    c.authorMeta = { username: r.username, avatarUrl: r.avatar_url };
  }
  return c;
}

// GET /word/:word/comments?cursor= -> Paginated<Comment> newest first.
export async function listComments(
  db: Db,
  rawWord: string,
  cursor: string | null,
): Promise<Paginated<Comment>> {
  const word = normalizeWordParam(rawWord);
  const offset = cursor ? Math.min(Math.max(0, parseInt(cursor, 10) || 0), 100000) : 0;

  const { results } = await db
    .prepare(
      `SELECT c.id, c.token_id, c.word, c.author, c.body, c.ts,
              p.username AS username, p.avatar_url AS avatar_url
       FROM comments c
       LEFT JOIN profiles p ON p.address = c.author
       WHERE c.word = ?
       ORDER BY c.ts DESC, c.id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(word, COMMENTS_PAGE + 1, offset)
    .all<{
      id: number;
      token_id: string | null;
      word: string;
      author: string;
      body: string;
      ts: number;
      username: string | null;
      avatar_url: string | null;
    }>();

  const hasMore = results.length > COMMENTS_PAGE;
  const page = results.slice(0, COMMENTS_PAGE);
  return {
    items: page.map(rowToComment),
    cursor: hasMore ? String(offset + COMMENTS_PAGE) : null,
  };
}

// POST /word/:word/comments — body {body,timestamp,signature}. Signer = author.
export async function postComment(
  db: Db,
  addressLower: string,
  rawWord: string,
  body: { body?: string; timestamp?: number; signature?: `0x${string}` },
): Promise<Comment> {
  const address = addressLower;
  const word = normalizeWordParam(rawWord);

  const text = (body.body ?? "").trim();
  if (text === "") throw new HttpError(400, "empty comment");
  if (text.length > COMMENT_MAX) throw new HttpError(400, "comment too long");

  const timestamp = Number(body.timestamp);
  const message = commentMessage(address, word, text, timestamp);
  await verifySigned(message, address, body.signature as `0x${string}`, timestamp);
  await enforceFreshness(db, body.signature as `0x${string}`, timestamp);

  // Resolve the token id for this word (may be null if unclaimed).
  const wordRow = await db
    .prepare("SELECT token_id FROM words WHERE word = ?")
    .bind(word)
    .first<{ token_id: string }>();
  const tokenId = wordRow?.token_id ?? null;
  const ts = Date.now();

  const ins = await db
    .prepare(
      "INSERT INTO comments (token_id, word, author, body, ts) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(tokenId, word, address, text, ts)
    .run();

  // Read back the row (with authorMeta) for the newest comment by this author.
  const row = await db
    .prepare(
      `SELECT c.id, c.token_id, c.word, c.author, c.body, c.ts,
              p.username AS username, p.avatar_url AS avatar_url
       FROM comments c
       LEFT JOIN profiles p ON p.address = c.author
       WHERE c.word = ? AND c.author = ? AND c.ts = ?
       ORDER BY c.id DESC LIMIT 1`,
    )
    .bind(word, address, ts)
    .first<{
      id: number;
      token_id: string | null;
      word: string;
      author: string;
      body: string;
      ts: number;
      username: string | null;
      avatar_url: string | null;
    }>();

  if (row) return rowToComment(row);
  // Fallback (shouldn't happen): synthesize from what we inserted.
  return {
    id: Number((ins as unknown as { meta?: { last_row_id?: number } }).meta?.last_row_id ?? 0),
    tokenId: tokenId ?? "",
    word,
    author: checksum(address),
    body: text,
    ts,
  };
}

// ── search ──────────────────────────────────────────────────────────────────

function likePrefix(q: string): string {
  // Escape LIKE wildcards in the user term, then append the prefix %.
  return q.replace(/[\\%_]/g, (m) => `\\${m}`) + "%";
}

// GET /search?q=
export async function search(db: Db, qRaw: string): Promise<SearchResult> {
  const q = (qRaw ?? "").trim().toLowerCase();
  if (q === "") return { words: [], users: [] };

  // If it looks like a word, normalize it for the word prefix match.
  const norm = normalizeWord(q);
  const wordTerm = norm.ok ? norm.normalized : q;

  const { results: words } = await db
    .prepare(
      "SELECT word, token_id, owner FROM words WHERE word IS NOT NULL AND word LIKE ? ESCAPE '\\' ORDER BY word LIMIT ?",
    )
    .bind(likePrefix(wordTerm), SEARCH_LIMIT)
    .all<{ word: string; token_id: string; owner: string | null }>();

  const { results: users } = await db
    .prepare(
      "SELECT address, username, avatar_url FROM profiles WHERE username IS NOT NULL AND username LIKE ? ESCAPE '\\' ORDER BY username LIMIT ?",
    )
    .bind(likePrefix(q), SEARCH_LIMIT)
    .all<{ address: string; username: string | null; avatar_url: string | null }>();

  return {
    words: words.map((w) => ({
      word: w.word,
      tokenId: w.token_id,
      owner: w.owner ? checksum(w.owner) : null,
    })),
    users: users.map((u) => ({
      address: checksum(u.address),
      username: u.username,
      avatarUrl: u.avatar_url,
    })),
  };
}

// ── global activity ──────────────────────────────────────────────────────────

// GET /activity?cursor= -> Paginated<ActivityRow> newest first.
export async function globalActivity(
  db: Db,
  cursor: string | null,
): Promise<Paginated<ActivityRow>> {
  const offset = cursor ? Math.min(Math.max(0, parseInt(cursor, 10) || 0), 100000) : 0;
  const { results } = await db
    .prepare(
      "SELECT address, type, token_id, word, counterparty, price, ts, tx FROM activity ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?",
    )
    .bind(ACTIVITY_PAGE + 1, offset)
    .all<{
      address: string;
      type: string;
      token_id: string;
      word: string | null;
      counterparty: string | null;
      price: string | null;
      ts: number;
      tx: string;
    }>();
  const hasMore = results.length > ACTIVITY_PAGE;
  const page = results.slice(0, ACTIVITY_PAGE);
  return {
    items: page.map(toActivityRow),
    cursor: hasMore ? String(offset + ACTIVITY_PAGE) : null,
  };
}

// ── watchlist ────────────────────────────────────────────────────────────────

// GET /watchlist/:address -> WordRow[]
export async function getWatchlist(db: Db, addressLower: string): Promise<WordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT w.token_id, w.word, w.owner, w.claimed_at, w.tx
       FROM watchlist wl
       JOIN words w ON w.token_id = wl.token_id
       WHERE wl.address = ?
       ORDER BY wl.ts DESC`,
    )
    .bind(addressLower)
    .all<{ token_id: string; word: string | null; owner: string; claimed_at: number; tx: string }>();
  return results.map(toWordRow);
}

// POST /watchlist/:address — body {tokenId,on,timestamp,signature}
export async function toggleWatchlist(
  db: Db,
  addressLower: string,
  body: { tokenId?: string; on?: boolean; timestamp?: number; signature?: `0x${string}` },
): Promise<{ on: boolean }> {
  const address = addressLower;
  const tokenId = String(body.tokenId ?? "");
  if (tokenId === "") throw new HttpError(400, "missing tokenId");
  const on = !!body.on;
  const timestamp = Number(body.timestamp);
  const message = watchlistMessage(address, tokenId, on, timestamp);
  await verifySigned(message, address, body.signature as `0x${string}`, timestamp);
  await enforceFreshness(db, body.signature as `0x${string}`, timestamp);

  if (on) {
    await db
      .prepare(
        "INSERT INTO watchlist (address, token_id, ts) VALUES (?, ?, ?) ON CONFLICT(address, token_id) DO UPDATE SET ts = excluded.ts",
      )
      .bind(address, tokenId, Date.now())
      .run();
  } else {
    await db
      .prepare("DELETE FROM watchlist WHERE address = ? AND token_id = ?")
      .bind(address, tokenId)
      .run();
  }
  return { on };
}
