// Demo content layer — a curated set of "already-claimed" popular words plus their
// comment threads, so arriving on the site feels alive even before real on-chain
// activity exists. Gated by VITE_DEMO_MODE; only fills surfaces that are EMPTY for
// real (the moment real words/comments exist, real data wins). NO fake trades or
// prices — these are registered words (market: null), matching "just claimed".
import type { WordRow, WordDetail, ActivityRow, Stats, Profile } from "@shared/types";
import type { Comment } from "@shared/social";
import { DEMO_MODE } from "./config";

export const DEMO = DEMO_MODE;

// Stable demo "owners" — valid 0x addresses (display-only; never used to sign).
const A = [
  "0x6Bf2A1c4D8e90F3a5B7c1029384756aB1C2d3E4f",
  "0x9aE13b7C2f4D5601a8B9c0D1e2F3a4B5c6D7e8F9",
  "0x21cD45e6F7081923A4b5C6d7E8f90123456789Ab",
  "0xC4d5E6f70819A2b3C4d5E6f7081920A1b2c3D4e5",
  "0x7E8f90A1b2C3d4E5f60718293A4b5C6d7E8f9012",
  "0x3a4B5c6D7e8F901a2B3c4D5e6F708192a3B4c5D6",
  "0xF0e1D2c3B4a5968778695A4b3C2d1E0f9A8b7C6d",
  "0x5B6c7D8e9F0a1B2c3D4e5F60718293a4B5c6D7e8",
] as const;

// Most-recognisable common English words — desirable, brandable, instantly legible.
// [word, ownerIndex, claimed-hours-ago]
const W: [string, number, number][] = [
  ["love", 0, 0.15],
  ["money", 1, 0.4],
  ["time", 2, 0.8],
  ["god", 3, 1.3],
  ["world", 4, 2.1],
  ["power", 5, 3.0],
  ["fire", 6, 4.2],
  ["dream", 7, 5.5],
  ["king", 0, 7.0],
  ["gold", 1, 9.0],
  ["life", 2, 11.0],
  ["music", 3, 14.0],
  ["water", 4, 18.0],
  ["light", 5, 22.0],
  ["hope", 6, 27.0],
  ["luck", 7, 33.0],
  ["queen", 0, 40.0],
  ["peace", 2, 52.0],
];

const USERS = [
  "satoshi", "degenmike", "wordlord", "based_anon", "alpha_seeker",
  "gm_ser", "vibe_dealer", "onchain_ous", "frenly", "the_keeper",
];

// One handle per demo owner (parallel to A), so owner profiles read as real people.
const OWNER_NAMES = [
  "satoshi", "degenmike", "wordlord", "based_anon",
  "alpha_seeker", "gm_ser", "vibe_dealer", "onchain_ous",
];

const SAYINGS = [
  (w: string) => `gm to every "${w}" believer`,
  (w: string) => `imagine not owning "${w}", couldn't be me`,
  (w: string) => `"${w}" is the only word that matters tbh`,
  (w: string) => `wish i kept "${w}" first 😤`,
  (w: string) => `one word, one owner. "${w}" is forever now`,
  (w: string) => `how much for "${w}"? name your price`,
  (w: string) => `this is the alpha. "${w}" holders eating good`,
  (w: string) => `early on "${w}". screenshot this`,
];

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function tokenId(i: number): string {
  // Deterministic, unique, plausible uint256-as-decimal — never collides with real ids.
  return (10n ** 30n + BigInt(i * 7919 + 1)).toString();
}

function txHash(i: number): string {
  const h = (i * 2654435761) >>> 0;
  return "0xdem0" + h.toString(16).padStart(8, "0").repeat(7).slice(0, 60);
}

const SLUGS = new Set(W.map(([w]) => w));
export function demoHasWord(word: string): boolean {
  return DEMO && SLUGS.has(word.trim().toLowerCase());
}

export function demoWords(): WordRow[] {
  const now = nowSec();
  return W.map(([word, o, ageH], i) => ({
    tokenId: tokenId(i),
    word,
    owner: A[o],
    claimedAt: now - Math.round(ageH * 3600),
    tx: txHash(i),
  }));
}

export function demoStats(): Stats {
  const owners = new Set(W.map(([, o]) => o)).size;
  return {
    wordsClaimed: W.length,
    uniqueOwners: owners,
    totalVolumeWei: "0",
    sales: 0,
  };
}

export function demoActivity(): ActivityRow[] {
  const now = nowSec();
  return W.map(([word, o, ageH], i) => ({
    address: A[o],
    type: "claim" as const,
    tokenId: tokenId(i),
    word,
    ts: now - Math.round(ageH * 3600),
    tx: txHash(i),
  })).sort((a, b) => b.ts - a.ts);
}

export function demoWordDetail(word: string): WordDetail {
  const slug = word.trim().toLowerCase();
  const i = W.findIndex(([w]) => w === slug);
  const [w, o, ageH] = W[i];
  return {
    word: w,
    tokenId: tokenId(i),
    owner: A[o],
    claimedAt: nowSec() - Math.round(ageH * 3600),
    history: [],
    listing: null,
    market: null, // registered, no live market — no fake trading
  };
}

export function demoComments(word: string): Comment[] {
  const slug = word.trim().toLowerCase();
  const i = W.findIndex(([w]) => w === slug);
  if (i < 0) return [];
  const now = nowSec();
  // 2–4 deterministic comments per word, newest first.
  const count = 2 + (i % 3);
  const out: Comment[] = [];
  for (let k = 0; k < count; k++) {
    const sIdx = (i + k * 3) % SAYINGS.length;
    const uIdx = (i * 2 + k) % USERS.length;
    out.push({
      id: i * 100 + k,
      tokenId: tokenId(i),
      word: slug,
      author: A[(o(i) + k) % A.length],
      authorMeta: { username: USERS[uIdx], avatarUrl: null },
      body: SAYINGS[sIdx](slug),
      ts: Date.now() - (k * 1800 + 600) * 1000,
    });
  }
  return out;
}

function o(i: number): number {
  return W[i][1];
}

/** True when an address is one of the demo owners (so we can synthesize its profile). */
export function demoIsOwner(addr: string): boolean {
  if (!DEMO) return false;
  const a = addr.toLowerCase();
  return A.some((x) => x.toLowerCase() === a);
}

/** Synthesize a demo owner's profile (their words + claim activity) so badges link cleanly. */
export function demoProfile(addr: string): Profile {
  const a = addr.toLowerCase();
  const idx = A.findIndex((x) => x.toLowerCase() === a);
  const checksum = idx >= 0 ? A[idx] : addr;
  const owned = demoWords().filter((w) => w.owner.toLowerCase() === a);
  const activity = demoActivity().filter((x) => x.address.toLowerCase() === a);
  return {
    address: checksum,
    meta: {
      address: checksum,
      username: idx >= 0 ? OWNER_NAMES[idx] : null,
      bio: "collecting words on Keepney",
      avatarUrl: null,
      twitterHandle: null,
      twitterVerified: false,
      website: null,
      updatedAt: null,
    },
    owned,
    listings: [],
    activity,
    stats: { owned: owned.length, volumeWei: "0" },
  };
}
