// REST API route handlers. Responses match /shared/src/types.ts exactly.

import { getAddress } from "viem";
import type { Db } from "./db.js";
import { normalizeWord } from "../../shared/src/normalize.js";
import type {
  WordRow,
  ListingRow,
  SaleRow,
  WordDetail,
  Stats,
  CheckResult,
  Paginated,
} from "../../shared/src/types.js";

const PAGE_SIZE = 50;
// L1: never let an offset cursor run unbounded.
const MAX_OFFSET = 100_000;

function checksum(addr: string | null | undefined): string {
  if (!addr) return "";
  try {
    return getAddress(addr as `0x${string}`);
  } catch {
    return addr;
  }
}

function toWordRow(r: {
  token_id: string;
  word: string | null;
  owner: string;
  claimed_at: number;
  tx: string;
}): WordRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    owner: checksum(r.owner),
    claimedAt: Number(r.claimed_at ?? 0),
    tx: r.tx ?? "",
  };
}

function toListingRow(r: {
  token_id: string;
  word: string | null;
  price: string;
  seller: string;
  active: number;
}): ListingRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    price: r.price ?? "0",
    seller: checksum(r.seller),
    active: !!r.active,
  };
}

function toSaleRow(r: {
  token_id: string;
  word: string | null;
  price: string;
  from_addr: string;
  to_addr: string;
  ts: number;
}): SaleRow {
  return {
    tokenId: r.token_id,
    word: r.word ?? "",
    price: r.price ?? "0",
    from: checksum(r.from_addr),
    to: checksum(r.to_addr),
    ts: Number(r.ts ?? 0),
  };
}

// GET /words?sort=recent|volume&cursor=
export async function getWords(
  db: Db,
  sort: string,
  cursor: string | null,
): Promise<Paginated<WordRow>> {
  const offset = cursor ? Math.min(Math.max(0, parseInt(cursor, 10) || 0), MAX_OFFSET) : 0;
  let sql: string;
  if (sort === "volume") {
    // H4: order by the maintained per-token `volume_wei` column (indexed) instead of a
    // correlated subquery over `sales`. CAST(... AS REAL) keeps the magnitude ordering
    // (exact ties broken by claimed_at) while staying within a double.
    sql = `
      SELECT token_id, word, owner, claimed_at, tx
      FROM words
      ORDER BY CAST(volume_wei AS REAL) DESC, claimed_at DESC
      LIMIT ? OFFSET ?`;
  } else {
    sql = `
      SELECT token_id, word, owner, claimed_at, tx
      FROM words
      ORDER BY claimed_at DESC, token_id DESC
      LIMIT ? OFFSET ?`;
  }
  const { results } = await db
    .prepare(sql)
    .bind(PAGE_SIZE + 1, offset)
    .all<{
      token_id: string;
      word: string | null;
      owner: string;
      claimed_at: number;
      tx: string;
    }>();

  const hasMore = results.length > PAGE_SIZE;
  const page = results.slice(0, PAGE_SIZE);
  return {
    items: page.map(toWordRow),
    cursor: hasMore ? String(offset + PAGE_SIZE) : null,
  };
}

// GET /word/:word  (path param normalized first)
export async function getWordDetail(db: Db, rawWord: string): Promise<WordDetail> {
  const norm = normalizeWord(rawWord);
  const word = norm.ok ? norm.normalized : rawWord.toLowerCase();

  const wordRow = await db
    .prepare("SELECT token_id, word, owner, claimed_at, tx FROM words WHERE word = ?")
    .bind(word)
    .first<{ token_id: string; word: string | null; owner: string; claimed_at: number; tx: string }>();

  if (!wordRow) {
    return {
      word,
      tokenId: "",
      owner: null,
      claimedAt: null,
      history: [],
      listing: null,
    };
  }

  const { results: salesRows } = await db
    .prepare(
      "SELECT token_id, word, price, from_addr, to_addr, ts FROM sales WHERE token_id = ? ORDER BY ts DESC",
    )
    .bind(wordRow.token_id)
    .all<{
      token_id: string;
      word: string | null;
      price: string;
      from_addr: string;
      to_addr: string;
      ts: number;
    }>();

  const listingRow = await db
    .prepare("SELECT token_id, word, price, seller, active FROM listings WHERE token_id = ? AND active = 1")
    .bind(wordRow.token_id)
    .first<{ token_id: string; word: string | null; price: string; seller: string; active: number }>();

  return {
    word: wordRow.word ?? word,
    tokenId: wordRow.token_id,
    owner: wordRow.owner ? checksum(wordRow.owner) : null,
    claimedAt: wordRow.owner ? Number(wordRow.claimed_at ?? 0) : null,
    history: salesRows.map(toSaleRow),
    listing: listingRow ? toListingRow(listingRow) : null,
  };
}

// GET /profile/:address lives in social.ts (it now joins the off-chain profiles row).

// GET /market -> all active listings (with their word), newest first.
export async function getMarket(db: Db): Promise<ListingRow[]> {
  const { results } = await db
    .prepare(
      "SELECT token_id, word, price, seller, active FROM listings WHERE active = 1 ORDER BY rowid DESC",
    )
    .all<{ token_id: string; word: string | null; price: string; seller: string; active: number }>();
  return results.map(toListingRow);
}

// GET /check/:word
export async function getCheck(db: Db, rawWord: string): Promise<CheckResult> {
  const norm = normalizeWord(rawWord);
  if (!norm.ok) {
    return {
      input: rawWord,
      valid: false,
      available: false,
      normalized: "",
      reason: norm.reason,
    };
  }
  const claimed = await db
    .prepare("SELECT token_id FROM words WHERE word = ?")
    .bind(norm.normalized)
    .first<{ token_id: string }>();

  return {
    input: rawWord,
    valid: true,
    available: !claimed,
    normalized: norm.normalized,
    reason: claimed ? "already claimed" : "",
  };
}

// GET /stats — H3: counts via COUNT(*), volume/sales from the running `stats_agg`
// row maintained in handleSale. Never scans the full `sales` table per request.
export async function getStats(db: Db): Promise<Stats> {
  const wc = await db
    .prepare("SELECT COUNT(*) AS c FROM words WHERE word IS NOT NULL")
    .first<{ c: number }>();
  const uo = await db
    .prepare("SELECT COUNT(DISTINCT owner) AS c FROM words WHERE owner IS NOT NULL AND owner != ''")
    .first<{ c: number }>();
  const agg = await db
    .prepare("SELECT volume_wei, sales FROM stats_agg WHERE id = 1")
    .first<{ volume_wei: string | null; sales: number }>();

  return {
    wordsClaimed: Number(wc?.c ?? 0),
    uniqueOwners: Number(uo?.c ?? 0),
    totalVolumeWei: (agg?.volume_wei ?? "0").toString(),
    sales: Number(agg?.sales ?? 0),
  };
}
