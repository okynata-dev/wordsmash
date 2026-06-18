// Pure, idempotent event handlers over the `Db` interface.
//
// Each handler takes a decoded on-chain event plus context (block timestamp,
// tx hash, log index) and upserts the derived rows. Handlers MUST be safe to
// replay: re-applying the same (tx, logIndex) range produces identical DB
// state. We achieve this with:
//   - natural primary keys + INSERT OR REPLACE for words/listings, and
//   - a processed_logs dedup guard for the append-only sales/activity tables.

import type { Db } from "./db.js";
import { normalizeWord } from "../../shared/src/normalize.js";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface EventContext {
  tx: string; // tx hash
  logIndex: number; // log index within the block
  ts: number; // block timestamp (unix seconds)
}

export interface WordClaimedEvent {
  word: string; // raw word from event (already normalized on-chain)
  tokenId: bigint;
  owner: string;
  market?: string; // v2: per-word bonding-curve market clone address
}

export interface TradeEvent {
  market: string; // the emitting WordMarket clone (resolved from the log address)
  trader: string;
  isBuy: boolean;
  ethWei: bigint; // ethAmount (ETH side of the trade)
  tokenAmount: bigint;
  priceWei: bigint; // newPrice after the trade
}

export interface GraduatedEvent {
  market: string; // the emitting WordMarket clone
}

export interface TransferEvent {
  from: string;
  to: string;
  tokenId: bigint;
}

export interface ListedEvent {
  tokenId: bigint;
  seller: string;
  price: bigint;
}

export interface CancelledEvent {
  tokenId: bigint;
  seller: string;
}

export interface SaleEvent {
  tokenId: bigint;
  seller: string;
  buyer: string;
  price: bigint;
  fee: bigint;
}

function uid(ctx: EventContext, tag: string): string {
  return `${ctx.tx}:${ctx.logIndex}:${tag}`;
}

/** Returns true if this log uid was already processed (and marks it otherwise). */
async function claimLog(db: Db, id: string): Promise<boolean> {
  const existing = await db
    .prepare("SELECT uid FROM processed_logs WHERE uid = ?")
    .bind(id)
    .first<{ uid: string }>();
  if (existing) return true;
  await db.prepare("INSERT OR IGNORE INTO processed_logs (uid) VALUES (?)").bind(id).run();
  return false;
}

async function wordForToken(db: Db, tokenId: string): Promise<string> {
  const row = await db
    .prepare("SELECT word FROM words WHERE token_id = ?")
    .bind(tokenId)
    .first<{ word: string }>();
  return row?.word ?? "";
}

async function insertActivity(
  db: Db,
  ctx: EventContext,
  tag: string,
  rows: Array<{
    address: string;
    type: string;
    tokenId: string;
    word: string;
    counterparty?: string;
    price?: string;
  }>,
): Promise<void> {
  // One dedup guard per (log, tag); a single log can emit activity for two
  // parties (e.g. a sale touches seller and buyer) so we guard the pair.
  if (await claimLog(db, uid(ctx, `activity:${tag}`))) return;
  for (const r of rows) {
    await db
      .prepare(
        `INSERT INTO activity (address, type, token_id, word, counterparty, price, ts, tx)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        r.address.toLowerCase(),
        r.type,
        r.tokenId,
        r.word,
        r.counterparty ? r.counterparty.toLowerCase() : null,
        r.price ?? null,
        ctx.ts,
        ctx.tx,
      )
      .run();
  }
}

export async function handleWordClaimed(
  db: Db,
  ev: WordClaimedEvent,
  ctx: EventContext,
): Promise<void> {
  const tokenId = ev.tokenId.toString();
  const norm = normalizeWord(ev.word);
  const word = norm.ok ? norm.normalized : ev.word;
  const owner = ev.owner.toLowerCase();
  const market = ev.market ? ev.market.toLowerCase() : null;
  // The on-chain market ERC-20 symbol is the uppercase word (WordNormalizer.toUpper).
  const symbol = word.toUpperCase();

  // Upsert the word row. Idempotent via PK on token_id. We keep the original
  // claimed_at/tx if the row already exists (claim happens once). v2: also store
  // the market clone address so the indexer knows which contracts to watch.
  await db
    .prepare(
      `INSERT INTO words (token_id, word, owner, claimed_at, tx, market)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(token_id) DO UPDATE SET
         word = excluded.word,
         market = COALESCE(excluded.market, words.market)`,
    )
    .bind(tokenId, word, owner, ctx.ts, ctx.tx, market)
    .run();

  // v2: seed the per-market row so getLogs can resolve emitting addresses to a
  // word. Idempotent via PK; we never clobber accumulated volume/price/graduated.
  if (market) {
    await db
      .prepare(
        `INSERT INTO markets (market, token_id, word, token_symbol, volume_wei, last_price_wei, graduated)
         VALUES (?, ?, ?, ?, '0', '0', 0)
         ON CONFLICT(market) DO UPDATE SET
           token_id = excluded.token_id,
           word = excluded.word,
           token_symbol = excluded.token_symbol`,
      )
      .bind(market, tokenId, word, symbol)
      .run();
  }

  await insertActivity(db, ctx, "claim", [
    { address: owner, type: "claim", tokenId, word },
  ]);
}

export async function handleTrade(
  db: Db,
  ev: TradeEvent,
  ctx: EventContext,
): Promise<void> {
  const market = ev.market.toLowerCase();
  const trader = ev.trader.toLowerCase();

  // Resolve the word/token for this market (from the markets row seeded at claim).
  const m = await db
    .prepare("SELECT token_id, word FROM markets WHERE market = ?")
    .bind(market)
    .first<{ token_id: string; word: string | null }>();
  const tokenId = m?.token_id ?? "";
  const word = m?.word ?? "";

  // Append the trade row + bump market aggregates, guarded so reorg replay does
  // not duplicate the row or double-count volume (same rule as handleSale).
  if (!(await claimLog(db, uid(ctx, "trade")))) {
    await db
      .prepare(
        `INSERT INTO trades (market, token_id, word, trader, is_buy, eth_wei, token_amount, price_wei, ts, tx, log_index)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        market,
        tokenId,
        word,
        trader,
        ev.isBuy ? 1 : 0,
        ev.ethWei.toString(),
        ev.tokenAmount.toString(),
        ev.priceWei.toString(),
        ctx.ts,
        ctx.tx,
        ctx.logIndex,
      )
      .run();

    // volume += ethAmount (BigInt, TEXT); last_price_wei = newPrice.
    const cur = await db
      .prepare("SELECT volume_wei FROM markets WHERE market = ?")
      .bind(market)
      .first<{ volume_wei: string | null }>();
    const newVol = (BigInt(cur?.volume_wei ?? "0") + ev.ethWei).toString();
    await db
      .prepare(
        `INSERT INTO markets (market, token_id, word, volume_wei, last_price_wei, graduated)
         VALUES (?, ?, ?, ?, ?, 0)
         ON CONFLICT(market) DO UPDATE SET
           volume_wei = excluded.volume_wei,
           last_price_wei = excluded.last_price_wei`,
      )
      .bind(market, tokenId, word, newVol, ev.priceWei.toString())
      .run();
  }

  // Feed the activity table/feed: buys and sells show up like sales do.
  await insertActivity(db, ctx, "trade", [
    {
      address: trader,
      type: ev.isBuy ? "buy" : "sell",
      tokenId,
      word,
      price: ev.ethWei.toString(),
    },
  ]);
}

export async function handleGraduated(
  db: Db,
  ev: GraduatedEvent,
  _ctx: EventContext,
): Promise<void> {
  const market = ev.market.toLowerCase();
  // Idempotent: setting graduated=1 repeatedly is a no-op.
  await db
    .prepare("UPDATE markets SET graduated = 1 WHERE market = ?")
    .bind(market)
    .run();
}

export async function handleTransfer(
  db: Db,
  ev: TransferEvent,
  ctx: EventContext,
): Promise<void> {
  const tokenId = ev.tokenId.toString();
  const from = ev.from.toLowerCase();
  const to = ev.to.toLowerCase();

  if (from === ZERO_ADDRESS) {
    // Mint. WordClaimed carries the word; the mint Transfer may arrive in any
    // order, so ensure a words row exists and set the owner. We insert a NULL
    // placeholder word (M3) — never "" — so the partial unique index on
    // words(word) WHERE word IS NOT NULL does not make two pending mints
    // collide. The real word is filled in by handleWordClaimed.
    await db
      .prepare(
        `INSERT INTO words (token_id, word, owner, claimed_at, tx)
         VALUES (?, NULL, ?, ?, ?)
         ON CONFLICT(token_id) DO UPDATE SET owner = excluded.owner`,
      )
      .bind(tokenId, to, ctx.ts, ctx.tx)
      .run();
    return;
  }

  // Ownership change (direct transfer or marketplace settlement).
  await db.prepare("UPDATE words SET owner = ? WHERE token_id = ?").bind(to, tokenId).run();

  // Any active listing is no longer valid once the token moves.
  await db
    .prepare("UPDATE listings SET active = 0 WHERE token_id = ?")
    .bind(tokenId)
    .run();

  const word = await wordForToken(db, tokenId);
  await insertActivity(db, ctx, "transfer", [
    { address: from, type: "transfer", tokenId, word, counterparty: to },
    { address: to, type: "transfer", tokenId, word, counterparty: from },
  ]);
}

export async function handleListed(
  db: Db,
  ev: ListedEvent,
  ctx: EventContext,
): Promise<void> {
  const tokenId = ev.tokenId.toString();
  const seller = ev.seller.toLowerCase();
  const price = ev.price.toString();
  const word = await wordForToken(db, tokenId);

  await db
    .prepare(
      `INSERT INTO listings (token_id, word, price, seller, active)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(token_id) DO UPDATE SET
         word = excluded.word,
         price = excluded.price,
         seller = excluded.seller,
         active = 1`,
    )
    .bind(tokenId, word, price, seller)
    .run();

  await insertActivity(db, ctx, "list", [
    { address: seller, type: "list", tokenId, word, price },
  ]);
}

export async function handleCancelled(
  db: Db,
  ev: CancelledEvent,
  ctx: EventContext,
): Promise<void> {
  const tokenId = ev.tokenId.toString();
  const seller = ev.seller.toLowerCase();
  const word = await wordForToken(db, tokenId);

  await db.prepare("UPDATE listings SET active = 0 WHERE token_id = ?").bind(tokenId).run();

  await insertActivity(db, ctx, "cancel", [
    { address: seller, type: "cancel", tokenId, word },
  ]);
}

export async function handleSale(
  db: Db,
  ev: SaleEvent,
  ctx: EventContext,
): Promise<void> {
  const tokenId = ev.tokenId.toString();
  const seller = ev.seller.toLowerCase();
  const buyer = ev.buyer.toLowerCase();
  const price = ev.price.toString();
  const word = await wordForToken(db, tokenId);

  // Deactivate the listing and move ownership (the ERC721 Transfer also fires,
  // but settling here keeps state correct even if events arrive out of order).
  await db.prepare("UPDATE listings SET active = 0 WHERE token_id = ?").bind(tokenId).run();
  await db.prepare("UPDATE words SET owner = ? WHERE token_id = ?").bind(buyer, tokenId).run();

  // Append a sale row, guarded so reorg replay does not duplicate it. The same
  // guard also gates the running aggregates (stats_agg, per-token volume_wei) so
  // a replay never double-counts wei (H3/H4).
  if (!(await claimLog(db, uid(ctx, "sale")))) {
    await db
      .prepare(
        `INSERT INTO sales (token_id, word, price, from_addr, to_addr, ts, tx)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(tokenId, word, price, seller, buyer, ctx.ts, ctx.tx)
      .run();

    // H4: bump this token's cumulative volume (BigInt math, stored as TEXT).
    const cur = await db
      .prepare("SELECT volume_wei FROM words WHERE token_id = ?")
      .bind(tokenId)
      .first<{ volume_wei: string | null }>();
    const tokenVol = (BigInt(cur?.volume_wei ?? "0") + ev.price).toString();
    await db
      .prepare("UPDATE words SET volume_wei = ? WHERE token_id = ?")
      .bind(tokenVol, tokenId)
      .run();

    // H3: bump the global running aggregate so /stats never scans `sales`.
    const agg = await db
      .prepare("SELECT volume_wei, sales FROM stats_agg WHERE id = 1")
      .first<{ volume_wei: string | null; sales: number }>();
    const newVol = (BigInt(agg?.volume_wei ?? "0") + ev.price).toString();
    const newSales = Number(agg?.sales ?? 0) + 1;
    await db
      .prepare(
        `INSERT INTO stats_agg (id, volume_wei, sales) VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET volume_wei = excluded.volume_wei, sales = excluded.sales`,
      )
      .bind(newVol, newSales)
      .run();
  }

  await insertActivity(db, ctx, "sale", [
    { address: seller, type: "sale", tokenId, word, counterparty: buyer, price },
    { address: buyer, type: "sale", tokenId, word, counterparty: seller, price },
  ]);
}
