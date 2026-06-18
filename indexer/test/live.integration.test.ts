// Live integration test against a running anvil with the seeded deployment.
// Opt-in: skipped automatically unless a local chain + deployment file are present, so it never
// breaks `make test` in CI. Run it after `make chain && make deploy && make seed`.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createTestDb } from "../src/db.js";
import { runIndex, type Env } from "../src/indexer.js";
import { getStats, getWordDetail } from "../src/api.js";
import { getProfile } from "../src/social.js";

const depPath = resolve(__dirname, "../../shared/deployments/anvil.json");
const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8545";

async function anvilUp(): Promise<boolean> {
  if (!existsSync(depPath)) return false;
  try {
    const res = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const enabled = await anvilUp();

describe.skipIf(!enabled)("indexer against live anvil (seeded)", () => {
  it("indexes seeded claims + the deed sale and serves correct API data", async () => {
    const dep = JSON.parse(readFileSync(depPath, "utf8"));
    const schema = readFileSync(resolve(__dirname, "../schema.sql"), "utf8");
    const db = await createTestDb(schema);

    const env: Env = {
      DB: db,
      RPC_URL: RPC,
      REGISTRY: dep.wordRegistry,
      MARKETPLACE: dep.deedMarketplace,
      START_BLOCK: String(dep.startBlock ?? 0),
    };

    await runIndex(env);

    // Seed claimed >=3 words (genesis, wordsmash, base) and sold "base" to account #1.
    // Use >= so the test stays green even if the e2e suite has added more data to the chain.
    const stats = await getStats(db);
    expect(stats.wordsClaimed).toBeGreaterThanOrEqual(3);
    expect(stats.sales).toBeGreaterThanOrEqual(1);
    expect(BigInt(stats.totalVolumeWei)).toBeGreaterThanOrEqual(BigInt("50000000000000000")); // >= 0.05 ETH

    const base = await getWordDetail(db, "BASE"); // normalization applies
    expect(base.owner?.toLowerCase()).toBe("0x70997970c51812dc3a010c7d01b50e0d17dc79c8");
    expect(base.history.length).toBe(1);

    const profile = await getProfile(db, "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase());
    // account #0 claimed genesis/wordsmash/base and sold "base", so still owns 2.
    expect(profile.owned.length).toBe(2);
    expect(profile.activity.length).toBeGreaterThanOrEqual(3);
  });
});
