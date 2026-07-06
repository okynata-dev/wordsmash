// Shared types for the wordsmash API contract (indexer <-> web).

export interface WordRow {
  tokenId: string; // uint256 as decimal string
  word: string; // normalized
  owner: string; // checksummed address
  claimedAt: number; // unix seconds
  tx: string; // claim tx hash
  market?: string | null; // the word's bonding-curve market address (v2)
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

/** One day of protocol activity for the Stats page. */
export interface AnalyticsPoint {
  day: string; // YYYY-MM-DD (UTC)
  claims: number;
  trades: number;
  volumeWei: string; // gross token-trade ETH volume that day
}

/** One notification for the connected address (events touching their assets). */
export interface NotificationRow {
  kind: "trade_on_your_word" | "your_deed_sold" | "your_deed_bought";
  word: string;
  actor: string; // the other party (checksummed)
  isBuy?: boolean; // for trade_on_your_word
  amountWei: string; // trade ETH or sale price
  ts: number;
  tx: string;
}

/** Protocol-wide analytics: 30-day daily series + lifetime totals. */
export interface Analytics {
  daily: AnalyticsPoint[];
  totals: {
    words: number;
    markets: number;
    trades: number;
    uniqueTraders: number;
    tradeVolumeWei: string; // bonding-curve volume (gross)
    deedVolumeWei: string; // deed-marketplace sale volume
  };
}

/** A trader's net curve position candidate (from indexed trades; the client
    verifies real balances on-chain before display). */
export interface HolderRow {
  address: string; // checksummed
  netTokens: string; // net token_amount from trades (buys - sells), wei string
}

/** A market an address has ever traded on — candidate row for the Positions tab
    (the client reads live balanceOf on-chain; this only nominates markets). */
export interface PositionRow {
  word: string;
  market: string;
  tokenSymbol: string | null;
  lastPriceWei: string;
  costWei: string; // net ETH cost basis (buys gross - sells out), clamped ≥ 0
}

/** OHLC candle for the trading chart. Prices are wei strings; `t` is the bucket
    start (unix seconds); `v` is the ETH volume (wei) traded in the bucket. */
export interface Candle {
  t: number;
  o: string;
  h: string;
  l: string;
  c: string;
  v: string;
  n: number; // trades in the bucket
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
