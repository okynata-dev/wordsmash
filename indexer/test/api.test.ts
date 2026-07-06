import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleListed,
  handleSale,
  handleTrade,
} from "../src/handlers.js";
import { getCheck, getStats, getWordDetail, getMarket, getWordCandles, getWordHolders, getProfilePositions, getAnalytics } from "../src/api.js";
import { getProfile } from "../src/social.js";
import type { Db } from "../src/db.js";

async function seed(db: Db): Promise<void> {
  // bread (tid 1) claimed by alice, listed, sold to bob for 1000.
  await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 1n }, { tx: "0x1", logIndex: 0, ts: 10 });
  await handleWordClaimed(db, { word: "BREAD", tokenId: 1n, owner: A.alice }, { tx: "0x1", logIndex: 1, ts: 10 });
  await handleListed(db, { tokenId: 1n, seller: A.alice, price: 1000n }, { tx: "0x2", logIndex: 0, ts: 20 });
  await handleSale(db, { tokenId: 1n, seller: A.alice, buyer: A.bob, price: 1000n, fee: 25n }, { tx: "0x3", logIndex: 0, ts: 30 });

  // milk (tid 2) claimed by bob, never sold.
  await handleTransfer(db, { from: A.zero, to: A.bob, tokenId: 2n }, { tx: "0x4", logIndex: 0, ts: 40 });
  await handleWordClaimed(db, { word: "milk", tokenId: 2n, owner: A.bob }, { tx: "0x4", logIndex: 1, ts: 40 });

  // butter (tid 3) claimed by alice, sold to carol for 500.
  await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 3n }, { tx: "0x5", logIndex: 0, ts: 50 });
  await handleWordClaimed(db, { word: "butter", tokenId: 3n, owner: A.alice }, { tx: "0x5", logIndex: 1, ts: 50 });
  await handleSale(db, { tokenId: 3n, seller: A.alice, buyer: A.carol, price: 500n, fee: 12n }, { tx: "0x6", logIndex: 0, ts: 60 });
}

describe("GET /check", () => {
  it("normalizes input (BREAD -> bread) and reports claimed as unavailable", async () => {
    const db = await freshDb();
    await seed(db);

    const r = await getCheck(db, "BREAD");
    expect(r.normalized).toBe("bread");
    expect(r.valid).toBe(true);
    expect(r.available).toBe(false); // already claimed
    expect(r.input).toBe("BREAD");
  });

  it("reports an unclaimed valid word as available", async () => {
    const db = await freshDb();
    await seed(db);
    const r = await getCheck(db, "  Toast ");
    expect(r.normalized).toBe("toast");
    expect(r.valid).toBe(true);
    expect(r.available).toBe(true);
  });

  it("rejects invalid words", async () => {
    const db = await freshDb();
    const r = await getCheck(db, "bad word!");
    expect(r.valid).toBe(false);
    expect(r.available).toBe(false);
    expect(r.reason).toBeTruthy();
  });
});

describe("GET /stats", () => {
  it("returns correct totals over seeded data", async () => {
    const db = await freshDb();
    await seed(db);
    const s = await getStats(db);
    expect(s.wordsClaimed).toBe(3);
    // owners after sales: bread->bob, milk->bob, butter->carol => {bob, carol}
    expect(s.uniqueOwners).toBe(2);
    expect(s.sales).toBe(2);
    expect(s.totalVolumeWei).toBe("1500"); // 1000 + 500
  });
});

describe("GET /word/:word", () => {
  it("returns detail with history and null listing after sale", async () => {
    const db = await freshDb();
    await seed(db);
    const d = await getWordDetail(db, "BREAD");
    expect(d.word).toBe("bread");
    expect(d.tokenId).toBe("1");
    expect(d.owner).not.toBeNull();
    expect(d.history.length).toBe(1);
    expect(d.history[0].price).toBe("1000");
    expect(d.listing).toBeNull(); // listing deactivated by the sale
  });

  it("returns unclaimed shape for unknown word", async () => {
    const db = await freshDb();
    const d = await getWordDetail(db, "ghost");
    expect(d.owner).toBeNull();
    expect(d.claimedAt).toBeNull();
    expect(d.history).toEqual([]);
    expect(d.listing).toBeNull();
  });
});

describe("GET /profile/:address", () => {
  it("returns owned words and activity for an address", async () => {
    const db = await freshDb();
    await seed(db);
    const p = await getProfile(db, A.bob);
    // bob owns bread + milk
    expect(p.owned.map((w: { word: string }) => w.word).sort()).toEqual(["bread", "milk"]);
    expect(p.activity.length).toBeGreaterThan(0);
  });
});

describe("GET /market", () => {
  it("returns only active listings; a sold listing drops out", async () => {
    const db = await freshDb();
    await seed(db); // bread was listed then SOLD -> inactive
    // milk (tid 2) is listed and stays active.
    await handleListed(db, { tokenId: 2n, seller: A.bob, price: 7000n }, { tx: "0x7", logIndex: 0, ts: 70 });

    const market = await getMarket(db);
    expect(market.map((l) => l.word)).toEqual(["milk"]);
    expect(market[0].price).toBe("7000");
    expect(market[0].active).toBe(true);
  });
});

describe("GET /word/:word/candles", () => {
  const MKT = "0x00000000000000000000000000000000000000aa";

  async function seedTrades(db: Db): Promise<void> {
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 9n }, { tx: "0xa0", logIndex: 0, ts: 100 });
    await handleWordClaimed(db, { word: "coffee", tokenId: 9n, owner: A.alice, market: MKT }, { tx: "0xa0", logIndex: 1, ts: 100 });
    // Bucket 1 (res=300: t=0): three trades — open 100, high 150, low 90, close 90.
    await handleTrade(db, { market: MKT, trader: A.alice, isBuy: true, ethWei: 10n, tokenAmount: 1n, priceWei: 100n }, { tx: "0xa1", logIndex: 0, ts: 100 });
    await handleTrade(db, { market: MKT, trader: A.bob, isBuy: true, ethWei: 20n, tokenAmount: 1n, priceWei: 150n }, { tx: "0xa2", logIndex: 0, ts: 200 });
    await handleTrade(db, { market: MKT, trader: A.bob, isBuy: false, ethWei: 5n, tokenAmount: 1n, priceWei: 90n }, { tx: "0xa3", logIndex: 0, ts: 290 });
    // Bucket 2 (t=600): one trade at 120.
    await handleTrade(db, { market: MKT, trader: A.carol, isBuy: true, ethWei: 7n, tokenAmount: 1n, priceWei: 120n }, { tx: "0xa4", logIndex: 0, ts: 650 });
  }

  it("aggregates OHLC + volume per bucket, opens at the previous close", async () => {
    const db = await freshDb();
    await seedTrades(db);
    const candles = await getWordCandles(db, "COFFEE", "300");
    expect(candles.length).toBe(2);
    expect(candles[0]).toEqual({ t: 0, o: "100", h: "150", l: "90", c: "90", v: "35", n: 3 });
    // Second candle opens at the previous close (90), not its own first trade.
    expect(candles[1]).toEqual({ t: 600, o: "90", h: "120", l: "90", c: "120", v: "7", n: 1 });
  });

  it("falls back to res=300 on a bogus resolution and returns [] for unknown words", async () => {
    const db = await freshDb();
    await seedTrades(db);
    const bogus = await getWordCandles(db, "coffee", "123");
    expect(bogus.length).toBe(2);
    expect(await getWordCandles(db, "ghost", "300")).toEqual([]);
  });
});

describe("holders + positions", () => {
  const MKT2 = "0x00000000000000000000000000000000000000bb";

  it("nets buys minus sells per trader, drops non-positive, sorts desc", async () => {
    const db = await freshDb();
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 11n }, { tx: "0xb0", logIndex: 0, ts: 10 });
    await handleWordClaimed(db, { word: "tea", tokenId: 11n, owner: A.alice, market: MKT2 }, { tx: "0xb0", logIndex: 1, ts: 10 });
    await handleTrade(db, { market: MKT2, trader: A.alice, isBuy: true, ethWei: 1n, tokenAmount: 100n, priceWei: 1n }, { tx: "0xb1", logIndex: 0, ts: 20 });
    await handleTrade(db, { market: MKT2, trader: A.bob, isBuy: true, ethWei: 1n, tokenAmount: 300n, priceWei: 1n }, { tx: "0xb2", logIndex: 0, ts: 30 });
    await handleTrade(db, { market: MKT2, trader: A.alice, isBuy: false, ethWei: 1n, tokenAmount: 100n, priceWei: 1n }, { tx: "0xb3", logIndex: 0, ts: 40 });

    const holders = await getWordHolders(db, "TEA");
    expect(holders.length).toBe(1); // alice netted to zero and is dropped
    expect(holders[0].address.toLowerCase()).toBe(A.bob.toLowerCase());
    expect(holders[0].netTokens).toBe("300");

    const positions = await getProfilePositions(db, A.alice.toLowerCase());
    expect(positions.length).toBe(1); // candidate market even though net is zero (client verifies)
    expect(positions[0].word).toBe("tea");
    expect(positions[0].market).toBe(MKT2);
    expect(positions[0].costWei).toBe("0"); // bought 1 wei, sold 1 wei -> net 0, clamped
  });

  it("cost basis nets gross buys minus sell proceeds", async () => {
    const db = await freshDb();
    const MKT4 = "0x00000000000000000000000000000000000000dd";
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 31n }, { tx: "0xd0", logIndex: 0, ts: 10 });
    await handleWordClaimed(db, { word: "tin", tokenId: 31n, owner: A.alice, market: MKT4 }, { tx: "0xd0", logIndex: 1, ts: 10 });
    await handleTrade(db, { market: MKT4, trader: A.bob, isBuy: true, ethWei: 10n, tokenAmount: 5n, priceWei: 1n }, { tx: "0xd1", logIndex: 0, ts: 20 });
    await handleTrade(db, { market: MKT4, trader: A.bob, isBuy: false, ethWei: 3n, tokenAmount: 1n, priceWei: 1n }, { tx: "0xd2", logIndex: 0, ts: 30 });
    const p = await getProfilePositions(db, A.bob.toLowerCase());
    expect(p[0].costWei).toBe("7"); // 10 in - 3 out
  });
});

describe("analytics", () => {
  it("returns daily series + lifetime totals", async () => {
    const db = await freshDb();
    await seed(db); // 3 words, 2 deed sales
    const MKT3 = "0x00000000000000000000000000000000000000cc";
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 21n }, { tx: "0xc0", logIndex: 0, ts: 100 });
    await handleWordClaimed(db, { word: "cocoa", tokenId: 21n, owner: A.alice, market: MKT3 }, { tx: "0xc0", logIndex: 1, ts: 100 });
    await handleTrade(db, { market: MKT3, trader: A.bob, isBuy: true, ethWei: 5n, tokenAmount: 10n, priceWei: 1n }, { tx: "0xc1", logIndex: 0, ts: 200 });

    const a = await getAnalytics(db);
    expect(a.totals.words).toBe(4); // 3 seeded + cocoa
    expect(a.totals.trades).toBe(1);
    expect(a.totals.uniqueTraders).toBe(1);
    expect(a.totals.tradeVolumeWei).toBe("5");
    expect(a.totals.deedVolumeWei).toBe("1500"); // from seed()
    expect(a.daily.length).toBeGreaterThan(0);
    expect(a.daily.reduce((s, d) => s + d.claims, 0)).toBe(4);
    expect(a.daily.reduce((s, d) => s + d.trades, 0)).toBe(1);
  });
});
