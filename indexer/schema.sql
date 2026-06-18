-- wordsmash indexer D1 schema.
-- Applied to Cloudflare D1 in production and to an in-memory node:sqlite db in tests.

CREATE TABLE IF NOT EXISTS words (
  token_id   TEXT PRIMARY KEY,
  word       TEXT,
  owner      TEXT,
  claimed_at INTEGER,
  tx         TEXT,
  -- Per-token cumulative secondary-sale volume (wei, as TEXT to hold >2^53). H4.
  volume_wei TEXT DEFAULT '0'
);

-- M3: a mint-before-claim inserts a NULL placeholder word, so the old UNIQUE
-- column constraint (which treats '' as a colliding value) is replaced with a
-- partial unique index that only constrains real (non-NULL) words. Two pending
-- mints can therefore coexist until their WordClaimed events land.
CREATE UNIQUE INDEX IF NOT EXISTS idx_words_word_unique ON words(word) WHERE word IS NOT NULL;

CREATE TABLE IF NOT EXISTS listings (
  token_id TEXT PRIMARY KEY,
  word     TEXT,
  price    TEXT,
  seller   TEXT,
  active   INTEGER
);

CREATE TABLE IF NOT EXISTS sales (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id  TEXT,
  word      TEXT,
  price     TEXT,
  from_addr TEXT,
  to_addr   TEXT,
  ts        INTEGER,
  tx        TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  address      TEXT,
  type         TEXT,
  token_id     TEXT,
  word         TEXT,
  counterparty TEXT,
  price        TEXT,
  ts           INTEGER,
  tx           TEXT
);

CREATE TABLE IF NOT EXISTS indexer_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER
);

-- H3: running aggregate of marketplace volume so /stats never scans `sales`.
-- volume_wei is summed with BigInt in JS and stored as TEXT (can exceed 2^53).
CREATE TABLE IF NOT EXISTS stats_agg (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  volume_wei TEXT DEFAULT '0',
  sales      INTEGER DEFAULT 0
);
INSERT OR IGNORE INTO stats_agg (id, volume_wei, sales) VALUES (1, '0', 0);

-- Dedup guard for log-derived rows (sales, activity) so re-indexing an
-- overlapping block range (reorg replay) is a no-op. Natural primary keys
-- handle words/listings; this handles the append-only tables.
CREATE TABLE IF NOT EXISTS processed_logs (
  uid TEXT PRIMARY KEY
);

-- ── off-chain social layer ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  address          TEXT PRIMARY KEY,
  username         TEXT UNIQUE,
  bio              TEXT,
  avatar_url       TEXT,
  twitter          TEXT,
  twitter_verified INTEGER DEFAULT 0,
  website          TEXT,
  updated_at       INTEGER
);

CREATE TABLE IF NOT EXISTS comments (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT,
  word     TEXT,
  author   TEXT,
  body     TEXT,
  ts       INTEGER
);

CREATE TABLE IF NOT EXISTS watchlist (
  address  TEXT,
  token_id TEXT,
  ts       INTEGER,
  PRIMARY KEY (address, token_id)
);

CREATE INDEX IF NOT EXISTS idx_words_owner    ON words(owner);
CREATE INDEX IF NOT EXISTS idx_words_volume   ON words(volume_wei);
CREATE INDEX IF NOT EXISTS idx_activity_addr  ON activity(address);
CREATE INDEX IF NOT EXISTS idx_activity_ts    ON activity(ts);
CREATE INDEX IF NOT EXISTS idx_sales_token    ON sales(token_id);
CREATE INDEX IF NOT EXISTS idx_sales_word     ON sales(word);
CREATE INDEX IF NOT EXISTS idx_listings_active ON listings(active);
CREATE INDEX IF NOT EXISTS idx_comments_token  ON comments(token_id);
