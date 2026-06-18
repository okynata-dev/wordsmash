// Indexing + reconciliation logic.
//
// runIndex: advance the cursor by fetching logs since last_block (minus a reorg
// window), decoding them, and applying idempotent handlers.
// reconcile: spot-check N random claimed words' owners against the chain and
// correct drift in D1.

import {
  createPublicClient,
  http,
  parseAbiItem,
  type Log,
  type PublicClient,
} from "viem";
import type { Db } from "./db.js";
import {
  handleWordClaimed,
  handleTransfer,
  handleListed,
  handleCancelled,
  handleSale,
  handleTrade,
  handleGraduated,
  type EventContext,
} from "./handlers.js";

export const REORG_DEPTH = 12;
// H1/C2: page the block range in chunks so a fresh sync / catch-up over a huge
// range works (RPC providers cap getLogs ranges) and progress is durable.
export const CHUNK_SIZE = 2000;

export interface Env {
  DB: Db;
  RPC_URL: string;
  REGISTRY: string; // wordRegistry address
  MARKETPLACE: string; // deedMarketplace address
  START_BLOCK: string; // decimal string
}

// Event signatures (viem parseAbiItem).
const wordClaimedEvent = parseAbiItem(
  "event WordClaimed(string word, uint256 indexed tokenId, address indexed owner, address market)",
);
// v2 token-market events. Emitted by MANY clone addresses (one per word), so we
// fetch them with NO address filter and keep only logs from known markets.
const tradeEvent = parseAbiItem(
  "event Trade(address indexed trader, bool isBuy, uint256 ethAmount, uint256 tokenAmount, uint256 newPrice)",
);
const graduatedEvent = parseAbiItem("event Graduated(uint256 realEthReserve)");
const transferEvent = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
);
const listedEvent = parseAbiItem(
  "event Listed(uint256 indexed tokenId, address indexed seller, uint256 price)",
);
const cancelledEvent = parseAbiItem(
  "event Cancelled(uint256 indexed tokenId, address indexed seller)",
);
const saleEvent = parseAbiItem(
  "event Sale(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price, uint256 fee)",
);

function makeClient(env: Env): PublicClient {
  return createPublicClient({ transport: http(env.RPC_URL) });
}

async function getLastBlock(db: Db): Promise<number | null> {
  const row = await db
    .prepare("SELECT last_block FROM indexer_state WHERE id = 1")
    .first<{ last_block: number }>();
  return row ? Number(row.last_block) : null;
}

async function setLastBlock(db: Db, block: number): Promise<void> {
  // Monotonic: never move the cursor backwards (reorg replay starts < last_block).
  await db
    .prepare(
      `INSERT INTO indexer_state (id, last_block) VALUES (1, ?)
       ON CONFLICT(id) DO UPDATE SET last_block = MAX(last_block, excluded.last_block)`,
    )
    .bind(block)
    .run();
}

// Cache of block timestamps to avoid refetching within a single run.
async function blockTs(
  client: PublicClient,
  cache: Map<bigint, number>,
  blockNumber: bigint,
): Promise<number> {
  const hit = cache.get(blockNumber);
  if (hit !== undefined) return hit;
  const block = await client.getBlock({ blockNumber });
  const ts = Number(block.timestamp);
  cache.set(blockNumber, ts);
  return ts;
}

type AnyLog = Log<bigint, number, false> & {
  eventName?: string;
  args?: Record<string, unknown>;
};

/**
 * Fetch logs since the cursor (with reorg replay), decode and apply them.
 * Returns the new cursor block. Idempotent across overlapping runs.
 */
export async function runIndex(env: Env): Promise<{ from: number; to: number }> {
  const db = env.DB;
  const client = makeClient(env);

  const startBlock = Number(env.START_BLOCK || "0");
  const stored = await getLastBlock(db);
  const last = stored ?? startBlock - 1;

  const currentBlock = Number(await client.getBlockNumber());
  // Re-index the last REORG_DEPTH blocks each run; handlers are idempotent.
  const from = Math.max(startBlock, last - REORG_DEPTH + 1, 0);
  const to = currentBlock;

  if (to < from) {
    return { from, to: last };
  }

  // H1/C2: page [from, to] in CHUNK_SIZE windows and persist the cursor after each
  // chunk. A fresh sync / catch-up over a huge range therefore works (provider log
  // caps), and a mid-range failure leaves the cursor at the last completed chunk
  // (no stranded cursor, no dropped blocks) — the next run resumes from there.
  for (let lo = from; lo <= to; lo += CHUNK_SIZE) {
    const hi = Math.min(lo + CHUNK_SIZE - 1, to);
    await indexRange(env, lo, hi, client);
    await setLastBlock(db, hi);
  }
  return { from, to };
}

/** Fetch + apply logs for a concrete [from, to] range. Exposed for testing. */
export async function indexRange(
  env: Env,
  from: number,
  to: number,
  clientArg?: PublicClient,
): Promise<void> {
  const db = env.DB;
  const client = clientArg ?? makeClient(env);
  const tsCache = new Map<bigint, number>();

  const registry = env.REGISTRY as `0x${string}`;
  const marketplace = env.MARKETPLACE as `0x${string}`;

  const [claimed, transfers, listed, cancelled, sales, trades, graduated] = await Promise.all([
    client.getLogs({ address: registry, event: wordClaimedEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    client.getLogs({ address: registry, event: transferEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    client.getLogs({ address: marketplace, event: listedEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    client.getLogs({ address: marketplace, event: cancelledEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    client.getLogs({ address: marketplace, event: saleEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    // v2: no address filter — getLogs returns Trade/Graduated logs from every
    // contract in range; we filter to known market addresses below.
    client.getLogs({ event: tradeEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
    client.getLogs({ event: graduatedEvent, fromBlock: BigInt(from), toBlock: BigInt(to) }),
  ]);

  // Build the set of known market addresses: those already in D1 plus any
  // deployed by WordClaimed logs in THIS range (so a claim and its first trade
  // can land in the same range). The claim handler also seeds the markets row,
  // but trades may be ordered after the claim within the range, so we union both.
  const knownMarkets = new Set<string>();
  const { results: marketRows } = await db
    .prepare("SELECT market FROM markets")
    .all<{ market: string }>();
  for (const r of marketRows) if (r.market) knownMarkets.add(r.market.toLowerCase());
  for (const l of claimed) {
    const mkt = (l as AnyLog).args?.market;
    if (typeof mkt === "string") knownMarkets.add(mkt.toLowerCase());
  }

  const isKnownMarket = (l: AnyLog): boolean =>
    knownMarkets.has(String(l.address ?? "").toLowerCase());

  // Merge and order by (blockNumber, logIndex) so handlers see a consistent
  // sequence (claim/mint before transfers/sales/trades).
  const all: Array<{ kind: string; log: AnyLog }> = [
    ...claimed.map((l) => ({ kind: "claim", log: l as AnyLog })),
    ...transfers.map((l) => ({ kind: "transfer", log: l as AnyLog })),
    ...listed.map((l) => ({ kind: "listed", log: l as AnyLog })),
    ...cancelled.map((l) => ({ kind: "cancelled", log: l as AnyLog })),
    ...sales.map((l) => ({ kind: "sale", log: l as AnyLog })),
    ...trades.filter((l) => isKnownMarket(l as AnyLog)).map((l) => ({ kind: "trade", log: l as AnyLog })),
    ...graduated.filter((l) => isKnownMarket(l as AnyLog)).map((l) => ({ kind: "graduated", log: l as AnyLog })),
  ];

  all.sort((a, b) => {
    const bn = Number(a.log.blockNumber ?? 0n) - Number(b.log.blockNumber ?? 0n);
    if (bn !== 0) return bn;
    return (a.log.logIndex ?? 0) - (b.log.logIndex ?? 0);
  });

  for (const { kind, log } of all) {
    const ctx: EventContext = {
      tx: (log.transactionHash ?? "0x") as string,
      logIndex: log.logIndex ?? 0,
      ts: await blockTs(client, tsCache, log.blockNumber ?? 0n),
    };
    const args = (log.args ?? {}) as Record<string, unknown>;

    switch (kind) {
      case "claim":
        await handleWordClaimed(
          db,
          {
            word: String(args.word),
            tokenId: args.tokenId as bigint,
            owner: String(args.owner),
            market: args.market != null ? String(args.market) : undefined,
          },
          ctx,
        );
        break;
      case "transfer":
        await handleTransfer(
          db,
          { from: String(args.from), to: String(args.to), tokenId: args.tokenId as bigint },
          ctx,
        );
        break;
      case "listed":
        await handleListed(
          db,
          { tokenId: args.tokenId as bigint, seller: String(args.seller), price: args.price as bigint },
          ctx,
        );
        break;
      case "cancelled":
        await handleCancelled(
          db,
          { tokenId: args.tokenId as bigint, seller: String(args.seller) },
          ctx,
        );
        break;
      case "sale":
        await handleSale(
          db,
          {
            tokenId: args.tokenId as bigint,
            seller: String(args.seller),
            buyer: String(args.buyer),
            price: args.price as bigint,
            fee: args.fee as bigint,
          },
          ctx,
        );
        break;
      case "trade":
        await handleTrade(
          db,
          {
            market: String(log.address ?? ""),
            trader: String(args.trader),
            isBuy: Boolean(args.isBuy),
            ethWei: args.ethAmount as bigint,
            tokenAmount: args.tokenAmount as bigint,
            priceWei: args.newPrice as bigint,
          },
          ctx,
        );
        break;
      case "graduated":
        await handleGraduated(db, { market: String(log.address ?? "") }, ctx);
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** Reads the on-chain owner of a tokenId. Injectable so tests can stub it. */
export type OwnerReader = (tokenId: bigint) => Promise<string>;

function chainOwnerReader(env: Env): OwnerReader {
  const client = makeClient(env);
  const abi = [parseAbiItem("function ownerOf(uint256 tokenId) view returns (address)")];
  return async (tokenId: bigint) => {
    const owner = (await client.readContract({
      address: env.REGISTRY as `0x${string}`,
      abi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as string;
    return owner;
  };
}

/**
 * Re-read N random claimed words' owners on-chain and correct any drift in D1.
 * Logs drift via console.warn. `reader` is injectable for tests.
 *
 * TODO(M4): random sampling re-checks the same hot tokens and may never visit
 * cold ones; a round-robin / least-recently-checked cursor would give full
 * coverage over time. TODO(deep-reorg): runIndex only replays REORG_DEPTH blocks
 * and does not UNDO state from orphaned blocks beyond that window; a reorg deeper
 * than REORG_DEPTH would need an explicit undo pass. Skipped here as lower-priority.
 */
export async function reconcile(
  env: Env,
  n: number,
  reader?: OwnerReader,
): Promise<{ checked: number; corrected: number }> {
  const db = env.DB;
  const read = reader ?? chainOwnerReader(env);

  const { results } = await db
    .prepare("SELECT token_id, owner FROM words ORDER BY RANDOM() LIMIT ?")
    .bind(n)
    .all<{ token_id: string; owner: string }>();

  let corrected = 0;
  for (const row of results) {
    let chainOwner: string;
    try {
      chainOwner = (await read(BigInt(row.token_id))).toLowerCase();
    } catch (err) {
      console.warn(`reconcile: ownerOf(${row.token_id}) failed: ${String(err)}`);
      continue;
    }
    const dbOwner = (row.owner ?? "").toLowerCase();
    if (chainOwner !== dbOwner) {
      console.warn(
        `reconcile: drift on token ${row.token_id}: db=${dbOwner} chain=${chainOwner}; correcting`,
      );
      await db
        .prepare("UPDATE words SET owner = ? WHERE token_id = ?")
        .bind(chainOwner, row.token_id)
        .run();
      corrected++;
    }
  }
  return { checked: results.length, corrected };
}
