import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleListed,
  handleSale,
} from "../src/handlers.js";
import { getCheck, getStats, getWordDetail, getMarket } from "../src/api.js";
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
