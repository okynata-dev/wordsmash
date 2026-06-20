-- Waitlist signups for the pre-launch landing (Cloudflare D1, bound to Pages Functions).
CREATE TABLE IF NOT EXISTS signups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  word       TEXT NOT NULL,        -- the normalized word the visitor wants
  contact    TEXT,                 -- optional email / @handle to notify at launch
  created_at INTEGER NOT NULL,     -- unix ms
  ip_hash    TEXT                  -- truncated SHA-256 of the IP (abuse/dedup, not PII)
);
CREATE INDEX IF NOT EXISTS idx_signups_word ON signups(word);
CREATE INDEX IF NOT EXISTS idx_signups_created ON signups(created_at);
CREATE INDEX IF NOT EXISTS idx_signups_iphash ON signups(ip_hash);
