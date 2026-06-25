// Typed REST helpers for the indexer API.
// READS are plain GETs. WRITES to the social layer are authorized with a wallet
// signature: the client signs a message built by the SHARED builder, captures a
// timestamp, and POSTs { …fields, timestamp, signature }. The indexer rebuilds the
// same message and recovers the signer.
import { API_URL } from "./config";
import { normAddr } from "./lib/format";
import type {
  CheckResult,
  Stats,
  WordDetail,
  Profile,
  WordRow,
  ListingRow,
  Paginated,
  SearchResult,
  ActivityRow,
  TradeRow,
  PricePoint,
} from "@shared/types";
import type { Comment } from "@shared/social";
import {
  DEMO,
  demoHasWord,
  demoWords,
  demoStats,
  demoActivity,
  demoWordDetail,
  demoComments,
  demoIsOwner,
  demoProfile,
} from "./demo";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`API ${res.status} on ${path}`);
  }
  return (await res.json()) as T;
}

/**
 * GET an endpoint that returns a list. Accepts either a bare array or a
 * `{ items: [...] }` envelope, and coerces anything else to [] so a malformed
 * body never crashes render.
 */
async function getList<T>(path: string): Promise<T[]> {
  const data = await get<unknown>(path);
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object" && Array.isArray((data as { items?: unknown }).items)) {
    return (data as { items: T[] }).items;
  }
  return [];
}

/** POST JSON. Throws an Error whose `.status` carries the HTTP code for callers to branch on. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `API ${res.status} on ${path}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error ?? data.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  // Some POSTs return 204/empty.
  const text = await res.text();
  return (text ? JSON.parse(text) : (undefined as unknown)) as T;
}

export interface SignedFields {
  timestamp: number;
  signature: `0x${string}`;
}

/**
 * Leaderboard / discovery sort modes. `recent`/`volume` are v1 (claim recency /
 * deed-sale volume); `trading` is v2 — ranking by per-word token trading volume;
 * `graduating` surfaces not-yet-graduated markets closest to graduation first.
 */
export type WordSort = "recent" | "volume" | "trading" | "graduating";

export const api = {
  /** GET /check/:word -> availability for the taken-state. */
  check: (word: string) => get<CheckResult>(`/check/${encodeURIComponent(word)}`),

  /** GET /stats -> global counters. */
  stats: async (): Promise<Stats> => {
    const s = await get<Stats>(`/stats`);
    return DEMO && s.wordsClaimed === 0 ? demoStats() : s;
  },

  /** GET /word/:word -> detail incl. ownership history + listing + token market. */
  word: async (word: string): Promise<WordDetail> => {
    try {
      const d = await get<WordDetail>(`/word/${encodeURIComponent(word)}`);
      if (DEMO && d.owner === null && demoHasWord(word)) return demoWordDetail(word);
      return d;
    } catch (e) {
      if (DEMO && demoHasWord(word)) return demoWordDetail(word);
      throw e;
    }
  },

  /** GET /word/:word/trades?cursor= -> a page of token-market trades (newest first). */
  trades: (word: string, cursor?: string) => {
    const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    return get<Paginated<TradeRow>>(`/word/${encodeURIComponent(word)}/trades${qs}`);
  },

  /** GET /word/:word/chart -> price history points for the inline chart. */
  chart: (word: string) => getList<PricePoint>(`/word/${encodeURIComponent(word)}/chart`),

  /** GET /profile/:address -> meta + owned words, listings, activity, stats. */
  profile: async (address: string): Promise<Profile> => {
    try {
      return await get<Profile>(`/profile/${normAddr(address)}`);
    } catch (e) {
      if (DEMO && demoIsOwner(address)) return demoProfile(address);
      throw e;
    }
  },

  /** GET /words?sort=... -> a single page of words. Returns the paginated envelope. */
  wordsPage: (sort?: WordSort, cursor?: string) => {
    const params = new URLSearchParams();
    if (sort) params.set("sort", sort);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    return get<Paginated<WordRow>>(`/words${qs ? `?${qs}` : ""}`);
  },

  /**
   * GET /words?sort=... following the cursor to aggregate up to `maxPages` pages.
   * Returns the rows plus whether more pages remained (so callers can label a cap).
   */
  words: async (
    sort?: WordSort,
    maxPages = 5,
  ): Promise<{ items: WordRow[]; truncated: boolean }> => {
    const items: WordRow[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Paginated<WordRow> = await api.wordsPage(sort, cursor ?? undefined);
      if (Array.isArray(page?.items)) items.push(...page.items);
      cursor = page?.cursor ?? null;
      pages += 1;
    } while (cursor && pages < maxPages);
    if (DEMO && items.length === 0) return { items: demoWords(), truncated: false };
    return { items, truncated: Boolean(cursor) };
  },

  /** GET /market -> active listings (with their word). */
  market: () => getList<ListingRow>(`/market`),

  /** GET /activity -> recent platform-wide activity. */
  activity: async (): Promise<ActivityRow[]> => {
    const a = await getList<ActivityRow>(`/activity`);
    return DEMO && a.length === 0 ? demoActivity() : a;
  },

  /** GET /search?q= -> matching words and users. */
  search: async (q: string): Promise<SearchResult> => {
    let r: SearchResult;
    try {
      r = await get<SearchResult>(`/search?q=${encodeURIComponent(q)}`);
    } catch (e) {
      if (!DEMO) throw e;
      r = { words: [], users: [] };
    }
    if (!DEMO || r.words.length) return r;
    const ql = q.trim().toLowerCase();
    if (!ql) return r;
    const words = demoWords()
      .filter((w) => w.word.includes(ql))
      .slice(0, 8)
      .map((w) => ({ word: w.word, tokenId: w.tokenId, owner: w.owner }));
    return words.length ? { ...r, words } : r;
  },

  /** GET /u/:username -> the profile that owns a username (for username routing). */
  userByName: (username: string) => get<Profile>(`/u/${encodeURIComponent(username)}`),

  /** GET /word/:word/comments -> comment thread. */
  comments: async (word: string): Promise<Comment[]> => {
    try {
      const c = await getList<Comment>(`/word/${encodeURIComponent(word)}/comments`);
      if (c.length) return c;
    } catch {
      /* fall through to demo for demo words */
    }
    return DEMO && demoHasWord(word) ? demoComments(word) : [];
  },

  /** POST /word/:word/comments -> add a comment (signed). */
  postComment: (
    word: string,
    body: { address: string; body: string } & SignedFields,
  ) => post<Comment>(`/word/${encodeURIComponent(word)}/comments`, body),

  /** POST /profile/:address -> update profile meta (signed). */
  updateProfile: (
    address: string,
    body: {
      username: string | null;
      bio: string | null;
      twitterHandle: string | null;
      website: string | null;
    } & SignedFields,
  ) => post<Profile>(`/profile/${normAddr(address)}`, body),

  /** POST /profile/:address/avatar -> upload avatar (signed). */
  uploadAvatar: (
    address: string,
    body: { dataUrl: string } & SignedFields,
  ) => post<{ avatarUrl: string }>(`/profile/${normAddr(address)}/avatar`, body),

  /** GET /watchlist/:address -> watched words. */
  watchlist: (address: string) =>
    getList<WordRow>(`/watchlist/${normAddr(address)}`),

  /** POST /watchlist/:address -> toggle a word on/off the watchlist (signed). */
  toggleWatch: (
    address: string,
    body: { tokenId: string; on: boolean } & SignedFields,
  ) => post<{ on: boolean }>(`/watchlist/${normAddr(address)}`, body),
};

/** Source URL for a user's avatar image (server falls back to a generated gradient). */
export function avatarUrl(address: string): string {
  return `${API_URL}/avatar/${normAddr(address)}`;
}

/** Indexer share page (server-rendered, carries OG meta for unfurls). */
export function shareUrl(word: string): string {
  return `${API_URL}/share/${encodeURIComponent(word)}`;
}
