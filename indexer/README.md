# wordsmash indexer

A Cloudflare Worker that indexes on-chain wordsmash events into D1 (SQLite) and
serves a public REST API + OG images for rich link unfurls.

## What it does

- **Indexes** `WordClaimed`, ERC721 `Transfer`, and marketplace `Listed` /
  `Cancelled` / `Sale` events into D1.
- **Serves** a read-only REST API whose JSON matches `shared/src/types.ts`.
- **Renders** monochrome OG SVGs and server-rendered share pages (OpenGraph /
  Twitter meta) so shared links unfurl richly — crawlers don't run JS, so this
  server-rendered surface is what makes the share flywheel real.
- **Self-heals** via a periodic reconciliation pass that re-reads random words'
  owners on-chain and corrects D1 drift.

## Architecture

| File | Purpose |
| ---- | ------- |
| `src/index.ts` | Worker `fetch` + `scheduled` (cron) entrypoint, routing, CORS. |
| `src/api.ts` | Route handlers returning JSON per shared types. |
| `src/indexer.ts` | `runIndex(env)` (cursor + reorg replay) and `reconcile(env, n)`. |
| `src/handlers.ts` | Pure, idempotent event handlers over the `Db` interface. |
| `src/og.ts` | OG SVG + share HTML. |
| `src/db.ts` | `Db` interface (D1-shaped) + a `node:sqlite` adapter for tests. |
| `schema.sql` | D1 schema. |

### Idempotency & reorgs

Each run re-indexes the last `REORG_DEPTH` (12) blocks. Handlers are idempotent:
`words`/`listings` use natural primary keys with `INSERT ... ON CONFLICT`, and
the append-only `sales`/`activity` tables are guarded by a `processed_logs`
dedup table keyed on `(tx, logIndex, tag)`. Re-running an overlapping range is a
no-op for already-seen logs while still applying genuinely new state.

### The `Db` abstraction

All queries are written against a minimal `Db` interface mirroring D1
(`prepare(sql).bind(...).all()/first()/run()`). In the Worker, `env.DB`
(D1Database) satisfies it structurally. In tests, a `node:sqlite`-backed adapter
loads `schema.sql` into an in-memory database — no Cloudflare runtime needed.

## REST API

CORS: `GET` allowed from any origin (public read API).

- `GET /words?sort=recent|volume|trading&cursor=` → `Paginated<WordRow>`
  - `volume` = DEED secondary-sale volume (`words.volume_wei`, sum of marketplace sale prices)
  - `trading` = v2 TOKEN bonding-curve volume (`markets.volume_wei`, sum of trade ETH amounts) — a distinct metric
- `GET /word/:word` → `WordDetail` (path param normalized; `owner` null if unclaimed; `market` = `MarketInfo | null`)
  - market `priceWei`/`volumeWei`/`graduated`/`tokenSymbol` come from D1 (the `markets` row maintained from `Trade`/`Graduated` events — no RPC); `marketCapWei`/`deedFeesWei`/`tokenSupply` are live contract reads over `RPC_URL` (fall back to `"0"` if RPC is absent/unreachable)
- `GET /word/:word/trades?cursor=` → `Paginated<TradeRow>` (v2 token-market trades, newest-first)
- `GET /word/:word/chart` → `PricePoint[]` (price series from trades, oldest→newest, last 200 points)
- `GET /profile/:address` → `Profile`
- `GET /check/:word` → `CheckResult` (uses shared `normalizeWord`)
- `GET /stats` → `Stats`
- `GET /og/:word` → monochrome SVG (`image/svg+xml`)
- `GET /share/:word` → HTML page with OpenGraph/Twitter meta + redirect to the web app
- `POST /admin/index`, `POST /admin/reconcile?n=10` → manual triggers

## Local development (against anvil)

1. Start anvil and deploy the contracts (see `../contracts`). Note the
   `wordRegistry` / `deedMarketplace` addresses and the deployment block.
2. Create the local D1 database and apply the schema:
   ```sh
   npx wrangler d1 create wordsmash          # TODO(operator): paste id into wrangler.toml
   npx wrangler d1 execute wordsmash --local --file=./schema.sql
   ```
3. Set `RPC_URL`, `REGISTRY`, `MARKETPLACE`, `START_BLOCK` in `wrangler.toml`
   `[vars]` (see `.env.example` for descriptions).
4. Run the worker:
   ```sh
   npm run dev
   ```
5. Trigger an index pass manually:
   ```sh
   curl -X POST http://127.0.0.1:8787/admin/index
   curl http://127.0.0.1:8787/stats
   ```

## Deploy

```sh
npx wrangler d1 execute wordsmash --remote --file=./schema.sql
npm run deploy
```

`TODO(operator)` items (search the repo for `TODO(operator)`):

- `wrangler.toml` → real D1 `database_id`.
- `wrangler.toml` `[vars]` → real `RPC_URL`, `REGISTRY`, `MARKETPLACE`,
  `START_BLOCK`, `WEB_APP_BASE` for your target network.

## Testing

```sh
npm test        # vitest, backed by in-memory node:sqlite
npm run typecheck
```

Tests require Node 24+ (`node:sqlite`). The vitest forks pool passes
`--experimental-sqlite` automatically (see `vitest.config.ts`).

Coverage: idempotency (double-apply → identical state), reorg replay (overlapping
range updates without duplicating sales), reconciliation (drift correction with a
stubbed chain reader), and API shape (`/check` normalization, `/stats` totals).
