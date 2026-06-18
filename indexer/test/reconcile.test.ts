import { describe, it, expect, vi } from "vitest";
import { freshDb, A } from "./helpers.js";
import { handleTransfer, handleWordClaimed } from "../src/handlers.js";
import { reconcile, type Env } from "../src/indexer.js";

const TID = 99n;

function env(db: Awaited<ReturnType<typeof freshDb>>): Env {
  return {
    DB: db,
    RPC_URL: "http://localhost",
    REGISTRY: A.zero,
    MARKETPLACE: A.zero,
    START_BLOCK: "0",
  };
}

describe("reconcile", () => {
  it("corrects D1 owner when it drifts from chain owner", async () => {
    const db = await freshDb();
    await handleTransfer(db, { from: A.zero, to: A.alice, tokenId: TID }, {
      tx: "0x1",
      logIndex: 0,
      ts: 1,
    });
    await handleWordClaimed(db, { word: "drift", tokenId: TID, owner: A.alice }, {
      tx: "0x1",
      logIndex: 1,
      ts: 1,
    });

    // Simulate drift: write a wrong owner directly into D1.
    await db
      .prepare("UPDATE words SET owner = ? WHERE token_id = ?")
      .bind(A.bob.toLowerCase(), TID.toString())
      .run();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Chain says the real owner is carol.
    const reader = vi.fn(async (_t: bigint) => A.carol);
    const res = await reconcile(env(db), 10, reader);

    expect(res.checked).toBe(1);
    expect(res.corrected).toBe(1);
    expect(reader).toHaveBeenCalledWith(TID);
    expect(warn).toHaveBeenCalled();

    const row = await db
      .prepare("SELECT owner FROM words WHERE token_id = ?")
      .bind(TID.toString())
      .first<{ owner: string }>();
    expect(row?.owner).toBe(A.carol.toLowerCase());

    // A second reconcile with no drift corrects nothing.
    const reader2 = vi.fn(async (_t: bigint) => A.carol);
    const res2 = await reconcile(env(db), 10, reader2);
    expect(res2.corrected).toBe(0);

    warn.mockRestore();
  });
});
