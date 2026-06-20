// REST API route handlers. Responses match /shared/src/types.ts exactly.

import { createPublicClient, getAddress, http } from "viem";
import { wordMarketAbi } from "../../shared/src/abis.js";
import type { Db } from "./db.js";
import { normalizeWord } from "../../shared/src/normalize.js";
import type {
  WordRow,
  ListingRow,
  SaleRow,
  WordDetail,
  MarketInfo,
  TradeRow,
  PricePoint,
  Stats,
  CheckResult,
  Paginated,
} from "../../shared/src/types.js";

const PAGE_SIZE = 50;
// L1: never let an offset cursor run unbounded.
const MAX_OFFSET = 100_000;

function checksum(addr: string | null | undefined): string {
  if (!addr) return "";
  try {
    return getAddress(addr as `0x${string}`);
  } catch {
    return addr;
  }
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

function toSaleRow(r: {
  token_id: string;
  word: string | null;
  price: string;
  from_addr: string;
  to_addr: string;
  ts: number;
}): SaleRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    price: r.price ?? "0",
    from: checksum(r.from_addr),
    to: checksum(r.to_addr),
    ts: Number(r.ts ?? 0),
  };
}

function toTradeRow(r: {
  market: string;
  word: string | null;
  trader: string;
  is_buy: number;
  eth_wei: string;
  token_amount: string;
  price_wei: string;
  ts: number;
  tx: string;
}): TradeRow {
  return {
    market: checksum(r.market),
    word: r.word ?? "",
    trader: checksum(r.trader),
    isBuy: !!r.is_buy,
    ethWei: r.eth_wei ?? "0",
    tokenAmount: r.token_amount ?? "0",
    priceWei: r.price_wei ?? "0",
    ts: Number(r.ts ?? 0),
    tx: r.tx ?? "",
  };
}

// Reads the live on-chain values a market exposes that we don't maintain in D1
// (marketCap depends on circulating supply; deedFees + supply are pure reads).
// Injectable so tests can stub it without an RPC. Returns null on any failure so
// the rest of the word detail still serves.
export interface MarketChainReads {
  marketCapWei: string;
  deedFeesWei: string;
  tokenSupply: string;
  realEthReserveWei: string;
  graduationThresholdWei: string;
}
export type MarketReader = (market: string) => Promise<MarketChainReads | null>;

export function chainMarketReader(rpcUrl: string): MarketReader {
  const client = createPublicClient({ transport: http(rpcUrl) });
  return async (market: string) => {
    try {
      const m = { address: market as `0x${string}`, abi: wordMarketAbi } as const;
      const [cap, fees, supply, reserve, threshold] = await Promise.all([
        client.readContract({ ...m, functionName: "marketCapWei" }),
        client.readContract({ ...m, functionName: "deedFeesAccrued" }),
        client.readContract({ ...m, functionName: "totalSupply" }),
        client.readContract({ ...m, functionName: "realEthReserve" }),
        client.readContract({ ...m, functionName: "graduationThreshold" }),
      ]);
      return {
        marketCapWei: (cap as bigint).toString(),
        deedFeesWei: (fees as bigint).toString(),
        tokenSupply: (supply as bigint).toString(),
        realEthReserveWei: (reserve as bigint).toString(),
        graduationThresholdWei: (threshold as bigint).toString(),
      };
    } catch {
      return null;
    }
  };
}

/** Graduation progress in basis points (0..10000), clamped. */
export function progressBps(reserveWei: string, thresholdWei: string): number {
  try {
    const r = BigInt(reserveWei);
    const t = BigInt(thresholdWei);
    if (t <= 0n) return 0;
    const bps = Number((r * 10000n) / t);
    return Math.max(0, Math.min(10000, bps));
  } catch {
    return 0;
  }
}

// 10 ETH — matches the deployed curve config. TODO(operator): keep in sync if you change it.
const GRAD_THRESHOLD_WEI = "10000000000000000000";

// GET /words?sort=recent|volume|trading|graduating&cursor=
//   - sort=volume     ranks by DEED secondary-sale volume (words.volume_wei)
//   - sort=trading    ranks by TOKEN bonding-curve volume (markets.volume_wei)
//   - sort=graduating not-yet-graduated first, then closest to graduation (markets.real_eth_reserve)
// Every row also carries optional token-market fields (price, trade volume, graduation progress)
// so tiles can render a price + progress bar without an extra fetch.
export async function getWords(
  db: Db,
  sort: string,
  cursor: string | null,
): Promise<Paginated<WordRow>> {
  const offset = cursor ? Math.min(Math.max(0, parseInt(cursor, 10) || 0), MAX_OFFSET) : 0;
  let orderBy: string;
  if (sort === "trading") {
    orderBy = "CAST(COALESCE(m.volume_wei,'0') AS REAL) DESC, w.claimed_at DESC";
  } else if (sort === "graduating") {
    orderBy =
      "COALESCE(m.graduated,0) ASC, CAST(COALESCE(m.real_eth_reserve,'0') AS REAL) DESC, w.claimed_at DESC";
  } else if (sort === "volume") {
    orderBy = "CAST(w.volume_wei AS REAL) DESC, w.claimed_at DESC";
  } else {
    orderBy = "w.claimed_at DESC, w.token_id DESC";
  }
  const sql = `
    SELECT w.token_id AS token_id, w.word AS word, w.owner AS owner, w.claimed_at AS claimed_at, w.tx AS tx,
           m.last_price_wei AS price_wei, m.volume_wei AS m_volume, m.real_eth_reserve AS reserve, m.graduated AS m_grad
    FROM words w
    LEFT JOIN markets m ON m.market = w.market
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?`;
  const { results } = await db
    .prepare(sql)
    .bind(PAGE_SIZE + 1, offset)
    .all<{
      token_id: string;
      word: string | null;
      owner: string;
      claimed_at: number;
      tx: string;
      price_wei: string | null;
      m_volume: string | null;
      reserve: string | null;
      m_grad: number | null;
    }>();

  const hasMore = results.length > PAGE_SIZE;
  const page = results.slice(0, PAGE_SIZE);
  return {
    items: page.map((r) => ({
      ...toWordRow(r),
      // optional token-market fields (absent => no market yet)
      priceWei: r.price_wei ?? undefined,
      tradeVolumeWei: r.m_volume ?? undefined,
      graduated: r.m_grad != null ? !!r.m_grad : undefined,
      graduationProgressBps: r.reserve != null ? progressBps(r.reserve, GRAD_THRESHOLD_WEI) : undefined,
    })),
    cursor: hasMore ? String(offset + PAGE_SIZE) : null,
  };
}

// GET /word/:word  (path param normalized first)
//
// Price/volume/graduated/symbol come from D1 (the `markets` row maintained from
// Trade/Graduated events) — no RPC needed for those. marketCap/deedFees/supply
// are LIVE reads via the optional `reader` (a viem publicClient over RPC_URL):
// circulating supply isn't tracked in D1, and deed fees / supply are cheap pure
// reads. If `reader` is omitted or the read fails, those three fall back to "0"
// so the endpoint stays robust without an RPC.
export async function getWordDetail(
  db: Db,
  rawWord: string,
  reader?: MarketReader,
): Promise<WordDetail> {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase();

  const wordRow = await db
    .prepare("SELECT token_id, word, owner, claimed_at, tx, market FROM words WHERE word = ?")
    .bind(word)
    .first<{ token_id: string; word: string | null; owner: string; claimed_at: number; tx: string; market: string | null }>();

  if (!wordRow) {
    return {
      word,
      tokenId: "",
      owner: null,
      claimedAt: null,
      history: [],
      listing: null,
      market: null,
    };
  }

  const { results: salesRows } = await db
    .prepare(
      "SELECT token_id, word, price, from_addr, to_addr, ts FROM sales WHERE token_id = ? ORDER BY ts DESC",
    )
    .bind(wordRow.token_id)
    .all<{
      token_id: string;
      word: string | null;
      price: string;
      from_addr: string;
      to_addr: string;
      ts: number;
    }>();

  const listingRow = await db
    .prepare("SELECT token_id, word, price, seller, active FROM listings WHERE token_id = ? AND active = 1")
    .bind(wordRow.token_id)
    .first<{ token_id: string; word: string | null; price: string; seller: string; active: number }>();

  // v2: the per-word bonding-curve token market (null if the word has no market).
  let market: MarketInfo | null = null;
  if (wordRow.market) {
    const m = await db
      .prepare("SELECT market, token_symbol, volume_wei, last_price_wei, graduated FROM markets WHERE market = ?")
      .bind(wordRow.market.toLowerCase())
      .first<{
        market: string;
        token_symbol: string | null;
        volume_wei: string | null;
        last_price_wei: string | null;
        graduated: number;
      }>();
    if (m) {
      const live = reader ? await reader(m.market) : null;
      const traders = await db
        .prepare("SELECT COUNT(DISTINCT trader) AS c FROM trades WHERE market = ?")
        .bind(m.market)
        .first<{ c: number }>();
      const reserve = live?.realEthReserveWei ?? "0";
      const threshold = live?.graduationThresholdWei ?? "0";
      // Self-heal the approximate D1 reserve (which drives the discovery-board FOMO bars) with the
      // exact on-chain value whenever a coin page is viewed, so the boards don't drift.
      if (live?.realEthReserveWei) {
        await db
          .prepare("UPDATE markets SET real_eth_reserve = ? WHERE market = ?")
          .bind(live.realEthReserveWei, m.market)
          .run();
      }
      market = {
        market: checksum(m.market),
        priceWei: m.last_price_wei ?? "0",
        marketCapWei: live?.marketCapWei ?? "0",
        volumeWei: m.volume_wei ?? "0",
        graduated: !!m.graduated,
        deedFeesWei: live?.deedFeesWei ?? "0",
        tokenSupply: live?.tokenSupply ?? "0",
        tokenSymbol: m.token_symbol ?? "",
        realEthReserveWei: reserve,
        graduationThresholdWei: threshold,
        graduationProgressBps: progressBps(reserve, threshold),
        traders: Number(traders?.c ?? 0),
      };
    }
  }

  return {
    word: wordRow.word ?? word,
    tokenId: wordRow.token_id,
    owner: wordRow.owner ? checksum(wordRow.owner) : null,
    claimedAt: wordRow.owner ? Number(wordRow.claimed_at ?? 0) : null,
    history: salesRows.map(toSaleRow),
    listing: listingRow ? toListingRow(listingRow) : null,
    market,
  };
}

// GET /word/:word/trades?cursor= -> Paginated<TradeRow> newest-first.
export async function getWordTrades(
  db: Db,
  rawWord: string,
  cursor: string | null,
): Promise<Paginated<TradeRow>> {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase();
  const offset = cursor ? Math.min(Math.max(0, parseInt(cursor, 10) || 0), MAX_OFFSET) : 0;

  const wordRow = await db
    .prepare("SELECT token_id FROM words WHERE word = ?")
    .bind(word)
    .first<{ token_id: string }>();
  if (!wordRow) return { items: [], cursor: null };

  const { results } = await db
    .prepare(
      `SELECT market, word, trader, is_buy, eth_wei, token_amount, price_wei, ts, tx
       FROM trades WHERE token_id = ?
       ORDER BY ts DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(wordRow.token_id, PAGE_SIZE + 1, offset)
    .all<{
      market: string;
      word: string | null;
      trader: string;
      is_buy: number;
      eth_wei: string;
      token_amount: string;
      price_wei: string;
      ts: number;
      tx: string;
    }>();

  const hasMore = results.length > PAGE_SIZE;
  const page = results.slice(0, PAGE_SIZE);
  return {
    items: page.map(toTradeRow),
    cursor: hasMore ? String(offset + PAGE_SIZE) : null,
  };
}

// GET /word/:word/chart -> PricePoint[] oldest->newest, capped at the last CHART_CAP trades.
const CHART_CAP = 200;
export async function getWordChart(db: Db, rawWord: string): Promise<PricePoint[]> {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase();

  const wordRow = await db
    .prepare("SELECT token_id FROM words WHERE word = ?")
    .bind(word)
    .first<{ token_id: string }>();
  if (!wordRow) return [];

  // Take the most-recent CHART_CAP points (newest-first), then reverse to oldest->newest.
  const { results } = await db
    .prepare(
      `SELECT ts, price_wei FROM trades WHERE token_id = ?
       ORDER BY ts DESC, id DESC LIMIT ?`,
    )
    .bind(wordRow.token_id, CHART_CAP)
    .all<{ ts: number; price_wei: string }>();

  return results
    .map((r) => ({ ts: Number(r.ts ?? 0), priceWei: r.price_wei ?? "0" }))
    .reverse();
}

// GET /profile/:address lives in social.ts (it now joins the off-chain profiles row).

// GET /market -> all active listings (with their word), newest first.
export async function getMarket(db: Db): Promise<ListingRow[]> {
  const { results } = await db
    .prepare(
      "SELECT token_id, word, price, seller, active FROM listings WHERE active = 1 ORDER BY rowid DESC",
    )
    .all<{ token_id: string; word: string | null; price: string; seller: string; active: number }>();
  return results.map(toListingRow);
}

// GET /check/:word
export async function getCheck(db: Db, rawWord: string): Promise<CheckResult> {
  const norm = normalizeWord(rawWord);
  if (!norm.ok) {
    return {
      input: rawWord,
      valid: false,
      available: false,
      normalized: "",
      reason: norm.reason,
    };
  }
  const claimed = await db
    .prepare("SELECT token_id FROM words WHERE word = ?")
    .bind(norm.normalized)
    .first<{ token_id: string }>();

  return {
    input: rawWord,
    valid: true,
    available: !claimed,
    normalized: norm.normalized,
    reason: claimed ? "already claimed" : "",
  };
}

// GET /stats — H3: counts via COUNT(*), volume/sales from the running `stats_agg`
// row maintained in handleSale. Never scans the full `sales` table per request.
export async function getStats(db: Db): Promise<Stats> {
  const wc = await db
    .prepare("SELECT COUNT(*) AS c FROM words WHERE word IS NOT NULL")
    .first<{ c: number }>();
  const uo = await db
    .prepare("SELECT COUNT(DISTINCT owner) AS c FROM words WHERE owner IS NOT NULL AND owner != ''")
    .first<{ c: number }>();
  const agg = await db
    .prepare("SELECT volume_wei, sales FROM stats_agg WHERE id = 1")
    .first<{ volume_wei: string | null; sales: number }>();

  return {
    wordsClaimed: Number(wc?.c ?? 0),
    uniqueOwners: Number(uo?.c ?? 0),
    totalVolumeWei: (agg?.volume_wei ?? "0").toString(),
    sales: Number(agg?.sales ?? 0),
  };
}
