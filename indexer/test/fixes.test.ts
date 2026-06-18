import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleTransfer,
  handleWordClaimed,
  handleSale,
} from "../src/handlers.js";
import { getStats, getWords } from "../src/api.js";
import { getProfile } from "../src/social.js";
import worker from "../src/index.js";
import type { Db, NodeSqliteDb } from "../src/db.js";

// A wei value > 2^53 to prove BigInt aggregation (H3) never loses precision.
const BIG = 10_000_000_000_000_000_000n; // 1e19 > Number.MAX_SAFE_INTEGER

describe("stats_agg aggregate (H3) with > 2^53 wei", () => {
  it("sums big sales correctly and tracks count", async () => {
    const db = await freshDb();
    // two words, each sold once at BIG wei.
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 1n }, { tx: "0xa", logIndex: 0, ts: 1 });
    await handleWordClaimed(db, { word: "alpha", tokenId: 1n, owner: A.alice }, { tx: "0xa", logIndex: 1, ts: 1 });
    await handleSale(db, { tokenId: 1n, seller: A.alice, buyer: A.bob, price: BIG, fee: 0n }, { tx: "0xb", logIndex: 0, ts: 2 });

    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 2n }, { tx: "0xc", logIndex: 0, ts: 3 });
    await handleWordClaimed(db, { word: "beta", tokenId: 2n, owner: A.alice }, { tx: "0xc", logIndex: 1, ts: 3 });
    await handleSale(db, { tokenId: 2n, seller: A.alice, buyer: A.bob, price: BIG, fee: 0n }, { tx: "0xd", logIndex: 0, ts: 4 });

    const s = await getStats(db);
    expect(s.sales).toBe(2);
    expect(s.totalVolumeWei).toBe((BIG * 2n).toString());
    expect(s.wordsClaimed).toBe(2);
  });

  it("does not double-count on reorg replay (idempotent agg)", async () => {
    const db = await freshDb();
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 1n }, { tx: "0xa", logIndex: 0, ts: 1 });
    await handleWordClaimed(db, { word: "alpha", tokenId: 1n, owner: A.alice }, { tx: "0xa", logIndex: 1, ts: 1 });
    const saleCtx = { tx: "0xb", logIndex: 0, ts: 2 };
    await handleSale(db, { tokenId: 1n, seller: A.alice, buyer: A.bob, price: BIG, fee: 0n }, saleCtx);
    await handleSale(db, { tokenId: 1n, seller: A.alice, buyer: A.bob, price: BIG, fee: 0n }, saleCtx); // replay

    const s = await getStats(db);
    expect(s.sales).toBe(1);
    expect(s.totalVolumeWei).toBe(BIG.toString());
  });
});

describe("words.volume_wei column + sort=volume (H4)", () => {
  it("orders words by cumulative per-token volume", async () => {
    const db = await freshDb();
    // tid1 sold for 100, tid2 sold twice (50 + 300 = 350), tid3 never sold (0).
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 1n }, { tx: "0x1", logIndex: 0, ts: 1 });
    await handleWordClaimed(db, { word: "one", tokenId: 1n, owner: A.alice }, { tx: "0x1", logIndex: 1, ts: 1 });
    await handleSale(db, { tokenId: 1n, seller: A.alice, buyer: A.bob, price: 100n, fee: 0n }, { tx: "0x1s", logIndex: 0, ts: 2 });

    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 2n }, { tx: "0x2", logIndex: 0, ts: 3 });
    await handleWordClaimed(db, { word: "two", tokenId: 2n, owner: A.alice }, { tx: "0x2", logIndex: 1, ts: 3 });
    await handleSale(db, { tokenId: 2n, seller: A.alice, buyer: A.bob, price: 50n, fee: 0n }, { tx: "0x2s", logIndex: 0, ts: 4 });
    await handleSale(db, { tokenId: 2n, seller: A.bob, buyer: A.carol, price: 300n, fee: 0n }, { tx: "0x2t", logIndex: 0, ts: 5 });

    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 3n }, { tx: "0x3", logIndex: 0, ts: 6 });
    await handleWordClaimed(db, { word: "three", tokenId: 3n, owner: A.alice }, { tx: "0x3", logIndex: 1, ts: 6 });

    const page = await getWords(db, "volume", null);
    expect(page.items.map((w) => w.word)).toEqual(["two", "one", "three"]); // 350, 100, 0

    // sanity: the column itself holds the cumulative value as TEXT.
    const row = await db.prepare("SELECT volume_wei FROM words WHERE token_id = '2'").first<{ volume_wei: string }>();
    expect(row?.volume_wei).toBe("350");
  });
});

describe("M3: mint-before-claim inserts NULL word (no collision)", () => {
  it("two pending mints coexist; words count excludes placeholders", async () => {
    const db = await freshDb();
    // Two mints arrive before any WordClaimed -> both words NULL, no UNIQUE collision.
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: 10n }, { tx: "0xm1", logIndex: 0, ts: 1 });
    await handleTransfer(db, { from: A.zero, to: A.bob, tokenId: 11n }, { tx: "0xm2", logIndex: 0, ts: 2 });

    const c = await db.prepare("SELECT COUNT(*) AS c FROM words").first<{ c: number }>();
    expect(Number(c?.c)).toBe(2);
    const nulls = await db.prepare("SELECT COUNT(*) AS c FROM words WHERE word IS NULL").first<{ c: number }>();
    expect(Number(nulls?.c)).toBe(2);

    // /stats only counts claimed (non-NULL) words.
    const s = await getStats(db);
    expect(s.wordsClaimed).toBe(0);

    // Now the claims land and fill the real words.
    await handleWordClaimed(db, { word: "ten", tokenId: 10n, owner: A.alice }, { tx: "0xc1", logIndex: 0, ts: 3 });
    await handleWordClaimed(db, { word: "eleven", tokenId: 11n, owner: A.bob }, { tx: "0xc2", logIndex: 0, ts: 4 });

    const s2 = await getStats(db);
    expect(s2.wordsClaimed).toBe(2);

    // profile owned word for a still-pending mint surfaces as "".
    const db2 = await freshDb();
    await handleTransfer(db2, { from: A.zero, to: A.alice, tokenId: 20n }, { tx: "0xz", logIndex: 0, ts: 1 });
    const p = await getProfile(db2, A.alice);
    expect(p.owned.length).toBe(1);
    expect(p.owned[0].word).toBe("");
  });
});

function env(db: NodeSqliteDb, adminToken?: string) {
  return {
    DB: db as unknown as Db,
    RPC_URL: "http://localhost",
    REGISTRY: A.zero,
    MARKETPLACE: A.zero,
    START_BLOCK: "0",
    ADMIN_TOKEN: adminToken,
  };
}

describe("C1: admin auth", () => {
  it("rejects /admin/index without a bearer token (401)", async () => {
    const db = await freshDb();
    const req = new Request("https://x/admin/index", { method: "POST" });
    const res = await worker.fetch(req, env(db, "secret") as never);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong bearer token (401)", async () => {
    const db = await freshDb();
    const req = new Request("https://x/admin/reconcile", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    const res = await worker.fetch(req, env(db, "secret") as never);
    expect(res.status).toBe(401);
  });

  it("rejects when no ADMIN_TOKEN is configured", async () => {
    const db = await freshDb();
    const req = new Request("https://x/admin/index", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    const res = await worker.fetch(req, env(db, undefined) as never);
    expect(res.status).toBe(401);
  });
});

describe("router: validation + generic errors", () => {
  it("returns 400 for a bad :address param", async () => {
    const db = await freshDb();
    const req = new Request("https://x/profile/not-an-address", { method: "GET" });
    const res = await worker.fetch(req, env(db, "secret") as never);
    expect(res.status).toBe(400);
  });

  it("/stats has a Cache-Control header", async () => {
    const db = await freshDb();
    const req = new Request("https://x/stats", { method: "GET" });
    const res = await worker.fetch(req, env(db, "secret") as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=10");
  });
});
