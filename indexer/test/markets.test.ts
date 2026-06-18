import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleTrade,
  handleGraduated,
  type EventContext,
} from "../src/handlers.js";
import {
  getWordDetail,
  getWordTrades,
  getWordChart,
  getWords,
  type MarketReader,
} from "../src/api.js";
import { globalActivity } from "../src/social.js";
import { indexRange, type Env } from "../src/indexer.js";
import type { Db } from "../src/db.js";
import type { PublicClient } from "viem";

// "bread" deed + its market clone.
const TID = 1n;
const MARKET = "0xMarketmarketmarketmarketmarketMarket0001".toLowerCase();
const MARKET2 = "0xMarketmarketmarketmarketmarketMarket0002".toLowerCase();

// Wei amounts that exceed 2^53 (Number.MAX_SAFE_INTEGER ≈ 9.007e15) so BigInt
// summation is actually exercised (never SUM(CAST...)).
const BIG_A = 6_000_000_000_000_000_000n; // 6 ETH
const BIG_B = 7_000_000_000_000_000_000n; // 7 ETH

async function claimBread(db: Db): Promise<void> {
  await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: TID }, { tx: "0xm", logIndex: 0, ts: 100 });
  await handleWordClaimed(
    db,
    { word: "BREAD", tokenId: TID, owner: A.alice, market: MARKET },
    { tx: "0xm", logIndex: 1, ts: 100 },
  );
}

async function count(db: Db, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return Number(r?.c ?? 0);
}

describe("handleWordClaimed (v2 market)", () => {
  it("stores the market on the words row and upserts a markets row", async () => {
    const db = await freshDb();
    await claimBread(db);

    const w = await db
      .prepare("SELECT market FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ market: string }>();
    expect(w?.market).toBe(MARKET);

    const m = await db
      .prepare("SELECT token_id, word, token_symbol, volume_wei, graduated FROM markets WHERE market = ?")
      .bind(MARKET)
      .first<{ token_id: string; word: string; token_symbol: string; volume_wei: string; graduated: number }>();
    expect(m?.token_id).toBe(TID.toString());
    expect(m?.word).toBe("bread");
    expect(m?.token_symbol).toBe("BREAD"); // uppercase word (on-chain symbol)
    expect(m?.volume_wei).toBe("0");
    expect(m?.graduated).toBe(0);
  });

  it("re-claim (reorg replay) does not clobber accumulated market volume", async () => {
    const db = await freshDb();
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 50n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    // Replaying the claim must not reset volume_wei back to 0.
    await claimBread(db);
    const m = await db
      .prepare("SELECT volume_wei FROM markets WHERE market = ?")
      .bind(MARKET)
      .first<{ volume_wei: string }>();
    expect(m?.volume_wei).toBe(BIG_A.toString());
  });
});

describe("handleTrade", () => {
  it("inserts a trade row and bumps volume with BigInt (>2^53), sets last price", async () => {
    const db = await freshDb();
    await claimBread(db);

    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    await handleTrade(
      db,
      { market: MARKET, trader: A.carol, isBuy: false, ethWei: BIG_B, tokenAmount: 40n, priceWei: 9n },
      { tx: "0xt2", logIndex: 0, ts: 120 },
    );

    expect(await count(db, "trades")).toBe(2);
    const m = await db
      .prepare("SELECT volume_wei, last_price_wei FROM markets WHERE market = ?")
      .bind(MARKET)
      .first<{ volume_wei: string; last_price_wei: string }>();
    // 6e18 + 7e18 = 13e18, beyond 2^53.
    expect(m?.volume_wei).toBe((BIG_A + BIG_B).toString());
    expect(m?.last_price_wei).toBe("9"); // last trade's newPrice

    // trades resolved the word/token from the markets row.
    const t = await db
      .prepare("SELECT token_id, word, is_buy FROM trades ORDER BY id ASC LIMIT 1")
      .first<{ token_id: string; word: string; is_buy: number }>();
    expect(t?.token_id).toBe(TID.toString());
    expect(t?.word).toBe("bread");
    expect(t?.is_buy).toBe(1);
  });

  it("is idempotent under reorg replay (same tx,logIndex)", async () => {
    const db = await freshDb();
    await claimBread(db);

    const ctx: EventContext = { tx: "0xt1", logIndex: 0, ts: 110 };
    const ev = { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n };
    await handleTrade(db, ev, ctx);
    await handleTrade(db, ev, ctx); // replay -> no dup, no double-count

    expect(await count(db, "trades")).toBe(1);
    const m = await db
      .prepare("SELECT volume_wei FROM markets WHERE market = ?")
      .bind(MARKET)
      .first<{ volume_wei: string }>();
    expect(m?.volume_wei).toBe(BIG_A.toString());
    // exactly one activity row for the buy.
    expect(await count(db, "activity")).toBe(2); // claim + buy
  });

  it("records buy/sell into the activity feed", async () => {
    const db = await freshDb();
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    await handleTrade(
      db,
      { market: MARKET, trader: A.carol, isBuy: false, ethWei: BIG_B, tokenAmount: 40n, priceWei: 9n },
      { tx: "0xt2", logIndex: 0, ts: 120 },
    );

    const feed = await globalActivity(db, null);
    // "buy"/"sell" are v2 activity types stored in D1; the shared ActivityType
    // union doesn't list them, so compare via string.
    const types = feed.items.map((i) => i.type as string);
    expect(types).toContain("buy");
    expect(types).toContain("sell");
    const buy = feed.items.find((i) => (i.type as string) === "buy");
    expect(buy?.word).toBe("bread");
    expect(buy?.price).toBe(BIG_A.toString());
  });
});

describe("handleGraduated", () => {
  it("sets the graduated flag", async () => {
    const db = await freshDb();
    await claimBread(db);
    expect(
      (await db.prepare("SELECT graduated FROM markets WHERE market = ?").bind(MARKET).first<{ graduated: number }>())
        ?.graduated,
    ).toBe(0);

    await handleGraduated(db, { market: MARKET }, { tx: "0xg", logIndex: 0, ts: 130 });
    await handleGraduated(db, { market: MARKET }, { tx: "0xg", logIndex: 0, ts: 130 }); // idempotent

    expect(
      (await db.prepare("SELECT graduated FROM markets WHERE market = ?").bind(MARKET).first<{ graduated: number }>())
        ?.graduated,
    ).toBe(1);
  });
});

describe("GET /word/:word includes market info", () => {
  it("derives price/volume/graduated/symbol from D1 and live reads from the injected reader", async () => {
    const db = await freshDb();
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    await handleGraduated(db, { market: MARKET }, { tx: "0xg", logIndex: 0, ts: 130 });

    const reader: MarketReader = async () => ({
      marketCapWei: "1234",
      deedFeesWei: "555",
      tokenSupply: "1000000",
      realEthReserveWei: "5000000000000000000", // 5 ETH
      graduationThresholdWei: "10000000000000000000", // 10 ETH -> 50%
    });

    const d = await getWordDetail(db, "BREAD", reader);
    expect(d.market).not.toBeNull();
    expect(d.market?.priceWei).toBe("11"); // last_price from D1
    expect(d.market?.graduationProgressBps).toBe(5000); // 5/10 ETH
    expect(d.market?.traders).toBeGreaterThanOrEqual(1);
    expect(d.market?.volumeWei).toBe(BIG_A.toString()); // from D1
    expect(d.market?.graduated).toBe(true); // from D1
    expect(d.market?.tokenSymbol).toBe("BREAD"); // from D1
    // live (reader) fields:
    expect(d.market?.marketCapWei).toBe("1234");
    expect(d.market?.deedFeesWei).toBe("555");
    expect(d.market?.tokenSupply).toBe("1000000");
  });

  it("falls back to '0' for live fields when no reader is provided", async () => {
    const db = await freshDb();
    await claimBread(db);
    const d = await getWordDetail(db, "BREAD"); // no reader
    expect(d.market?.marketCapWei).toBe("0");
    expect(d.market?.deedFeesWei).toBe("0");
    expect(d.market?.tokenSupply).toBe("0");
  });

  it("market is null for a word without a market", async () => {
    const db = await freshDb();
    // claim without a market arg.
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 2n }, { tx: "0xn", logIndex: 0, ts: 50 });
    await handleWordClaimed(db, { word: "milk", tokenId: 2n, owner: A.alice }, { tx: "0xn", logIndex: 1, ts: 50 });
    const d = await getWordDetail(db, "milk");
    expect(d.market).toBeNull();
  });
});

describe("GET /word/:word/trades and /chart", () => {
  it("trades returns newest-first TradeRow shapes", async () => {
    const db = await freshDb();
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    await handleTrade(
      db,
      { market: MARKET, trader: A.carol, isBuy: false, ethWei: BIG_B, tokenAmount: 40n, priceWei: 9n },
      { tx: "0xt2", logIndex: 0, ts: 120 },
    );

    const page = await getWordTrades(db, "BREAD", null);
    expect(page.items.length).toBe(2);
    expect(page.items[0].ts).toBe(120); // newest first
    expect(page.items[0].isBuy).toBe(false);
    expect(page.items[0].ethWei).toBe(BIG_B.toString());
    expect(page.items[0].word).toBe("bread");
    expect(page.cursor).toBeNull();
  });

  it("chart returns PricePoint[] oldest->newest", async () => {
    const db = await freshDb();
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_A, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    await handleTrade(
      db,
      { market: MARKET, trader: A.carol, isBuy: false, ethWei: BIG_B, tokenAmount: 40n, priceWei: 9n },
      { tx: "0xt2", logIndex: 0, ts: 120 },
    );

    const chart = await getWordChart(db, "BREAD");
    expect(chart.map((p) => p.ts)).toEqual([110, 120]); // oldest -> newest
    expect(chart.map((p) => p.priceWei)).toEqual(["11", "9"]);
  });

  it("trades/chart return empty for an unknown word", async () => {
    const db = await freshDb();
    expect((await getWordTrades(db, "ghost", null)).items).toEqual([]);
    expect(await getWordChart(db, "ghost")).toEqual([]);
  });
});

describe("GET /words?sort=trading", () => {
  it("ranks by token-market volume (distinct from deed-sale volume)", async () => {
    const db = await freshDb();
    // bread: market MARKET, big token volume.
    await claimBread(db);
    await handleTrade(
      db,
      { market: MARKET, trader: A.bob, isBuy: true, ethWei: BIG_B, tokenAmount: 100n, priceWei: 11n },
      { tx: "0xt1", logIndex: 0, ts: 110 },
    );
    // milk: market MARKET2, smaller token volume.
    await handleTransfer(db, { from: A.zero, to: A.bob, tokenId: 2n }, { tx: "0xn", logIndex: 0, ts: 50 });
    await handleWordClaimed(
      db,
      { word: "milk", tokenId: 2n, owner: A.bob, market: MARKET2 },
      { tx: "0xn", logIndex: 1, ts: 50 },
    );
    await handleTrade(
      db,
      { market: MARKET2, trader: A.carol, isBuy: true, ethWei: 1_000n, tokenAmount: 5n, priceWei: 2n },
      { tx: "0xt2", logIndex: 0, ts: 60 },
    );

    const res = await getWords(db, "trading", null);
    expect(res.items.map((w) => w.word)).toEqual(["bread", "milk"]);
  });
});

describe("indexRange (v2 Trade/Graduated)", () => {
  it("filters no-address Trade logs to known markets, decodes, and applies them", async () => {
    const db = await freshDb();
    // Seed a claim so MARKET is a known market in D1.
    await claimBread(db);

    const NOISE = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"; // not a market

    // A fake viem client. getLogs dispatches by the event name; we return the
    // Trade event from BOTH the real market and a noise contract to prove the
    // address filter keeps only the known one.
    const fake = {
      getBlockNumber: async () => 200n,
      getBlock: async () => ({ timestamp: 150n }),
      getLogs: async (opts: { event?: { name?: string } }) => {
        const name = opts.event?.name;
        if (name === "Trade") {
          return [
            {
              address: MARKET,
              blockNumber: 150n,
              logIndex: 0,
              transactionHash: "0xt1",
              eventName: "Trade",
              args: { trader: A.bob, isBuy: true, ethAmount: BIG_A, tokenAmount: 100n, newPrice: 11n },
            },
            {
              address: NOISE, // must be filtered out
              blockNumber: 150n,
              logIndex: 1,
              transactionHash: "0xnoise",
              eventName: "Trade",
              args: { trader: A.carol, isBuy: true, ethAmount: 999n, tokenAmount: 1n, newPrice: 1n },
            },
          ];
        }
        if (name === "Graduated") {
          return [
            {
              address: MARKET,
              blockNumber: 151n,
              logIndex: 0,
              transactionHash: "0xg",
              eventName: "Graduated",
              args: { realEthReserve: BIG_A },
            },
          ];
        }
        return [];
      },
    } as unknown as PublicClient;

    const env: Env = {
      DB: db,
      RPC_URL: "http://unused",
      REGISTRY: "0x0000000000000000000000000000000000000001",
      MARKETPLACE: "0x0000000000000000000000000000000000000002",
      START_BLOCK: "0",
    };

    await indexRange(env, 140, 160, fake);

    // Only the known-market trade was applied (noise dropped).
    expect(await count(db, "trades")).toBe(1);
    const m = await db
      .prepare("SELECT volume_wei, graduated FROM markets WHERE market = ?")
      .bind(MARKET)
      .first<{ volume_wei: string; graduated: number }>();
    expect(m?.volume_wei).toBe(BIG_A.toString());
    expect(m?.graduated).toBe(1);
  });
});
