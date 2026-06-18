# Deploying wordsmash (Base Sepolia + Cloudflare)

Everything that doesn't need your credentials is already done and wired by scripts. This runbook is
the **remaining operator steps** — mostly the Cloudflare deploy. **Testnet only.** The app launches in
**closed beta** (the on-chain whitelist ships enabled), so the public can't claim/trade until you
flip it open — see the last section.

Architecture once deployed:

```
Base Sepolia ──▶ Worker (indexer + REST API + cron)  ◀── D1 (SQLite) + R2 (avatars)
                          ▲                                    │
                   wagmi writes                          reads (JSON)
                          │                                    ▼
                   Cloudflare Pages (the React app)  ◀─────────┘
```

## 0. Prerequisites (HUMAN TASKS — you provide these)
- A **Base Sepolia deployer key** with testnet ETH, and a Base Sepolia **RPC URL**.
- A **Cloudflare account** + `wrangler login` (or a `CLOUDFLARE_API_TOKEN` with Workers, Pages, D1, R2 scopes).
- Your closed-beta **whitelist** (a list of addresses) and the **protocol fee receiver** address.
- (Optional) a **WalletConnect** project id, and **X/Twitter OAuth** keys for *verified* handles.

Copy `/.env.example` → `/.env` and fill these in. Then:

```bash
make install      # deps + Foundry libs (libs are vendored, so this is mostly npm installs)
```

## 1. Deploy the contracts to Base Sepolia
```bash
cd contracts/tools && node merkle.mjs whitelist.txt   # your real allowlist -> root + proofs
cd ..
DEPLOYER_PRIVATE_KEY=0x… PROTOCOL_FEE_RECEIVER=0x… \
  forge script script/Deploy.s.sol:Deploy --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast --verify
```
This deploys the registry + marketplace (whitelist **enabled**), reserves the example word, and writes
`shared/deployments/baseSepolia.json` (addresses + start block). Note the printed addresses.

## 2. Wire the addresses into the app config (automated)
```bash
node scripts/wire-deploy.mjs baseSepolia --rpc "$BASE_SEPOLIA_RPC_URL"
```
Patches `indexer/wrangler.toml` (REGISTRY/MARKETPLACE/START_BLOCK/RPC_URL) and writes
`web/.env.production` with the contract addresses. (Re-run with `--api <workerUrl>` after step 3 to set
`VITE_API_URL`.)

## 3. Cloudflare: the indexer Worker + D1 (+ optional R2)
```bash
cd indexer
wrangler d1 create wordsmash                 # paste the printed database_id into wrangler.toml
wrangler d1 execute wordsmash --remote --file=./schema.sql   # create tables
wrangler secret put ADMIN_TOKEN              # a strong random string (gates POST /admin/*)
# optional avatars in R2 (else they fall back to inline data URLs):
#   wrangler r2 bucket create wordsmash-avatars   # then uncomment [[r2_buckets]] in wrangler.toml
wrangler deploy                              # -> https://wordsmash-indexer.<subdomain>.workers.dev
```
Set `PUBLIC_BASE` (this Worker's URL) and `WEB_APP_BASE` (your Pages URL from step 4) in
`wrangler.toml`, then `wrangler deploy` again. The cron (`*/1`) will start indexing from `START_BLOCK`.

## 4. Cloudflare Pages: the web app
```bash
node scripts/wire-deploy.mjs baseSepolia --rpc "$BASE_SEPOLIA_RPC_URL" \
  --api https://wordsmash-indexer.<subdomain>.workers.dev   # sets VITE_API_URL
cd web && npm run build
wrangler pages deploy dist --project-name wordsmash          # -> https://wordsmash.pages.dev
```
`_redirects` (already in `dist/`) handles SPA deep links. If you connect the GitHub repo in the Pages
dashboard instead, set build command `npm run build`, output `dist`, root `web/`, and the `VITE_*`
vars as Pages environment variables.

## 5. Closed beta → public launch
The product is usable **only by whitelisted wallets** until you decide to open it. Non-whitelisted
visitors see the "closed beta" state. To go public later (no redeploy):
```bash
cast send $REGISTRY "setWhitelistEnabled(bool)" false --rpc-url $BASE_SEPOLIA_RPC_URL --private-key 0x…
```
You can also grant/revoke individual wallets with `setWhitelisted(address,bool)` /
`setWhitelistedBatch(address[],bool)`, and rotate the Merkle root with `setWhitelistRoot`.

## CI/CD (optional, one-click after secrets)
`.github/workflows/deploy.yml` (manual `workflow_dispatch`) builds and deploys the Worker **and** Pages.
Add repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (and `VITE_API_URL`,
`VITE_WORD_REGISTRY`, `VITE_DEED_MARKETPLACE` as Actions variables) and run the workflow. Contract
deployment stays manual (it spends real testnet funds and writes the canonical addresses).

## Make targets
`make deploy-contracts` · `make wire` · `make deploy-indexer` · `make deploy-web` — thin wrappers
around the steps above (see the Makefile).
