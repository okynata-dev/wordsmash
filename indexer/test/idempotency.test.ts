import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleListed,
  handleSale,
  type EventContext,
} from "../src/handlers.js";
import type { Db } from "../src/db.js";

// tokenId for "bread" — arbitrary fixed value for tests.
const TID = 42n;

async function applySequence(db: Db): Promise<void> {
  // mint + claim
  const mintCtx: EventContext = { tx: "0xaa", logIndex: 0, ts: 1000 };
  await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: TID }, mintCtx);
  await handleWordClaimed(db, { word: "BREAD", tokenId: TID, owner: A.alice }, {
    tx: "0xaa",
    logIndex: 1,
    ts: 1000,
  });
  // list
  await handleListed(db, { tokenId: TID, seller: A.alice, price: 1000n }, {
    tx: "0xbb",
    logIndex: 0,
    ts: 1100,
  });
  // sale alice -> bob
  await handleSale(
    db,
    { tokenId: TID, seller: A.alice, buyer: A.bob, price: 1000n, fee: 25n },
    { tx: "0xcc", logIndex: 0, ts: 1200 },
  );
}

async function count(db: Db, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return Number(r?.c ?? 0);
}

describe("idempotency", () => {
  it("applying the same events twice yields identical DB state", async () => {
    const db = await freshDb();
    await applySequence(db);

    const snapshot = {
      words: await count(db, "words"),
      sales: await count(db, "sales"),
      activity: await count(db, "activity"),
      listings: await count(db, "listings"),
    };
    const ownerRow = await db
      .prepare("SELECT owner FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ owner: string }>();

    // Replay the exact same events.
    await applySequence(db);

    expect({
      words: await count(db, "words"),
      sales: await count(db, "sales"),
      activity: await count(db, "activity"),
      listings: await count(db, "listings"),
    }).toEqual(snapshot);

    const ownerRow2 = await db
      .prepare("SELECT owner FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ owner: string }>();
    expect(ownerRow2?.owner).toBe(ownerRow?.owner);
    expect(ownerRow2?.owner).toBe(A.bob.toLowerCase());

    // Exactly one word, one sale, one (inactive) listing.
    expect(snapshot.words).toBe(1);
    expect(snapshot.sales).toBe(1);
    expect(snapshot.listings).toBe(1);

    const listing = await db
      .prepare("SELECT active FROM listings WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ active: number }>();
    expect(listing?.active).toBe(0);
  });

  it("normalizes the claimed word", async () => {
    const db = await freshDb();
    await applySequence(db);
    const row = await db
      .prepare("SELECT word FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ word: string }>();
    expect(row?.word).toBe("bread");
  });
});
