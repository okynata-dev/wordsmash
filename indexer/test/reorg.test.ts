import { describe, it, expect } from "vitest";
import { freshDb, A } from "./helpers.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleSale,
  type EventContext,
} from "../src/handlers.js";
import type { Db } from "../src/db.js";

const TID = 7n;

async function count(db: Db, table: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).first<{ c: number }>();
  return Number(r?.c ?? 0);
}

describe("reorg handling", () => {
  it("re-indexing an overlapping window updates rather than duplicates", async () => {
    const db = await freshDb();

    // Initial pass: block 100 mint+claim, block 105 sale alice->bob.
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: TID }, {
      tx: "0xm",
      logIndex: 0,
      ts: 100,
    });
    await handleWordClaimed(db, { word: "cat", tokenId: TID, owner: A.alice }, {
      tx: "0xm",
      logIndex: 1,
      ts: 100,
    });
    await handleSale(
      db,
      { tokenId: TID, seller: A.alice, buyer: A.bob, price: 500n, fee: 10n },
      { tx: "0xs", logIndex: 0, ts: 105 },
    );

    expect(await count(db, "sales")).toBe(1);
    let owner = await db
      .prepare("SELECT owner FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ owner: string }>();
    expect(owner?.owner).toBe(A.bob.toLowerCase());

    // Reorg replay of the same window: same sale log replays (no dup) AND a new
    // ownership change appears in the replayed window (bob -> carol via transfer).
    await handleSale(
      db,
      { tokenId: TID, seller: A.alice, buyer: A.bob, price: 500n, fee: 10n },
      { tx: "0xs", logIndex: 0, ts: 105 }, // identical log -> deduped
    );
    await handleTransfer(db, { from: A.bob, to: A.carol, tokenId: TID }, {
      tx: "0xt",
      logIndex: 0,
      ts: 106,
    });

    // Sale count unchanged (no duplicate), ownership reflects the new transfer.
    expect(await count(db, "sales")).toBe(1);
    owner = await db
      .prepare("SELECT owner FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ owner: string }>();
    expect(owner?.owner).toBe(A.carol.toLowerCase());

    // Still exactly one word row.
    expect(await count(db, "words")).toBe(1);
  });
});
