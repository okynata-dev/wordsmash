// Shared types for the wordsmash API contract (indexer <-> web).

export interface WordRow {
  tokenId: string; // uint256 as decimal string
  word: string; // normalized
  owner: string; // checksummed address
  claimedAt: number; // unix seconds
  tx: string; // claim tx hash
}

export interface ListingRow {
  tokenId: string;
  word: string;
  price: string; // wei as decimal string
  seller: string;
  active: boolean;
}

export interface SaleRow {
  tokenId: string;
  word: string;
  price: string; // wei
  from: string;
  to: string;
  ts: number;
}

export type ActivityType = "claim" | "list" | "cancel" | "sale" | "transfer";

export interface ActivityRow {
  address: string;
  type: ActivityType;
  tokenId: string;
  word: string;
  counterparty?: string;
  price?: string;
  ts: number;
  tx: string;
}

export interface WordDetail {
  word: string;
  tokenId: string;
  owner: string | null; // null = unclaimed
  claimedAt: number | null;
  history: SaleRow[];
  listing: ListingRow | null;
}

// Off-chain profile metadata lives in social.ts; re-exported on Profile for one fetch.
import type { ProfileMeta } from "./social.js";

export interface Profile {
  address: string;
  meta: ProfileMeta;
  owned: WordRow[];
  listings: ListingRow[];
  activity: ActivityRow[];
  stats: { owned: number; volumeWei: string };
}

export interface SearchResult {
  words: Array<{ word: string; tokenId: string; owner: string | null }>;
  users: Array<{ address: string; username: string | null; avatarUrl: string | null }>;
}

export interface Stats {
  wordsClaimed: number;
  uniqueOwners: number;
  totalVolumeWei: string;
  sales: number;
}

export interface CheckResult {
  input: string;
  valid: boolean;
  available: boolean;
  normalized: string;
  reason: string;
}

export interface Paginated<T> {
  items: T[];
  cursor: string | null;
}
