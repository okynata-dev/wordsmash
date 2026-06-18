// Shared types for the wordsmash API contract (indexer <-> web).

export interface WordRow {
  tokenId: string; // uint256 as decimal string
  word: string; // normalized
  owner: string; // checksummed address
  claimedAt: number; // unix seconds
  tx: string; // claim tx hash
  // Optional token-market fields (present on /words rows once a word has a market):
  priceWei?: string; // spot price, wei/token
  tradeVolumeWei?: string; // token bonding-curve volume
  graduated?: boolean;
  graduationProgressBps?: number; // 0..10000 toward graduation
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

export type ActivityType = "claim" | "list" | "cancel" | "sale" | "transfer" | "buy" | "sell";

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

export interface MarketInfo {
  market: string; // the WordMarket clone address
  priceWei: string; // spot price, wei per token (scaled 1e18)
  marketCapWei: string; // circulating * price
  volumeWei: string; // cumulative trade volume (ETH side)
  graduated: boolean;
  deedFeesWei: string; // unclaimed deed-owner fees (claimable by the deed holder)
  tokenSupply: string;
  tokenSymbol: string;
  // graduation progress (the FOMO bar): real ETH in the curve vs the threshold that freezes buys.
  realEthReserveWei: string;
  graduationThresholdWei: string;
  graduationProgressBps: number; // 0..10000 (clamped)
  traders: number; // distinct trader count (manipulation-resistant proxy for holders)
}

export interface TradeRow {
  market: string;
  word: string;
  trader: string;
  isBuy: boolean;
  ethWei: string;
  tokenAmount: string;
  priceWei: string;
  ts: number;
  tx: string;
}

export interface PricePoint {
  ts: number;
  priceWei: string;
}

export interface WordDetail {
  word: string;
  tokenId: string;
  owner: string | null; // null = unclaimed
  claimedAt: number | null;
  history: SaleRow[];
  listing: ListingRow | null;
  market: MarketInfo | null; // the bonding-curve token market (v2)
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
