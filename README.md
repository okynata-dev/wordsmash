# wordsmash — v1

A launchpad where the asset is a **word**. Claiming a word mints a unique NFT (a **deed**). A given
word, in canonical form, can be claimed **only once, ever** — global uniqueness enforced on-chain.
No images, no descriptions — just the word. Owners resell deeds on a built-in marketplace, and every
address has a profile of the words it owns and its activity.

> ⚠️ **Experimental testnet software (Base Sepolia). Not an investment product.** No returns are
> promised or implied. Testnet only — no mainnet config, no real-fund paths.

**Scope:** claim + ownership + deed marketplace + closed-beta whitelist + anti-bot limit + share/OG
flywheel; a full **social layer** (rich profiles with avatar/bio/X/username/website, per-word
comments, search, live activity feed, watchlists); and a **per-word bonding-curve token market** —
claiming a word deploys its ERC-20, people buy/sell on the curve (pump.fun style), and trading fees
flow to the deed holder. The word/deed itself stays imageless; only *users* get avatars.

See **[DESIGN.md](DESIGN.md)** for how the system is designed against known launchpad failure modes
(the pump.fun admin-drain exploit, sniping/MEV, rug pulls, graduation). **Still testnet-only and not
professionally audited — not for real funds.**

## Monorepo

```
shared/     Canonical normalization (TS) + shared types + generated ABIs + whitelist proofs
contracts/  Foundry: WordRegistry (registry + deed ERC-721), DeedMarketplace, tests, deploy + Merkle tools
indexer/    Cloudflare Worker: event indexer -> D1, REST API, OG images + share pages
web/        React + Vite + TS + wagmi/viem + Tailwind frontend
.env.example, Makefile, .github/workflows/ci.yml
```

## How it fits together

```
on-chain events ──▶ indexer (D1) ──▶ REST API ──▶ web app (reads)
        ▲                                              │
        └──────────────  wagmi writes  ◀───────────────┘
```

- **Uniqueness.** `WordRegistry` is itself the deed ERC-721. `tokenId = uint256(keccak256(word))`,
  so the same normalized word maps to one tokenId, claimable once ever. (Folding the registry and
  deed into one contract is a deliberate prototype simplification — fewer moving parts, same
  behavior, and the transfer-gate lives right in the ERC-721 hook.)
- **Normalization** (`shared/src/normalize.ts` ⇄ `contracts/.../WordNormalizer.sol`): trim, lowercase
  `A–Z`, allow only `[a-z0-9]`, length 1–30; reject everything else (incl. all non-ASCII, which
  sidesteps Unicode homoglyphs). The two implementations are proven byte-identical against the same
  fixture (`shared/fixtures/normalization-vectors.json`) by both test suites.
- **Closed-beta whitelist.** One shared Merkle-gated allowlist governs claim, list, buy, and deed
  transfers. Addresses enroll once (`verifyWhitelist(proof)`), which caches a bool so cheap repeated
  checks — and transfer gating, which can't carry a proof — work. `whitelistEnabled` flips the whole
  gate off in one tx for public launch (no redeploy).
- **Anti-bot.** A per-address monotonic claim counter (`maxClaimsPerAddress`, default 3) that can't
  be bypassed by transferring deeds away; the owner can lift it later. Roadmap: a fairer mechanism
  (queue / Harberger) — see `TODO(operator)` markers.
- **Marketplace.** Fixed-price, flat 10% protocol fee, fully **pull-payment** (buy() moves no ETH out;
  seller proceeds, buyer refunds, and protocol fees are all withdrawn separately) — so no
  external-call reentrancy can touch funds.
- **Flywheel.** Share buttons compose a post ("I claimed the word `X` — only one will ever exist") +
  a link to the indexer's server-rendered `/share/:word` page, which carries OpenGraph/Twitter meta
  pointing at `/og/:word` (a clean monochrome image) so shares unfurl richly.
- **Social layer.** User profiles (avatar, bio, X/Twitter, username, website), per-word comments,
  search, a live activity feed, and watchlists. All off-chain in D1, behind **SIWE-lite auth**: the
  client signs a message (built from the canonical builders in `shared/src/social.ts`), the indexer
  recovers the signer and verifies it owns the address — no passwords, no sessions. Avatars upload to
  R2 (with a deterministic gradient fallback). X handles are self-attested; OAuth verification is a
  HUMAN TASK. The same shared message builders are used on both sides, so signing and verification
  can never drift.

## Run the whole thing locally

Prereqs: [Foundry](https://book.getfoundry.sh) (anvil/forge), Node 20+, `jq`.

```bash
make install                 # all JS deps + Foundry libs
make merkle                  # build whitelist root + proofs from the address list (default: anvil accts)

# 4 terminals (or backgrounded):
make chain                   # 1) anvil on :8545
make deploy                  # 2) deploy + write shared/deployments/anvil.json
make seed                    # 3) demo data: claims, a listing, a sale
make indexer-dev             # 4) apply D1 schema + run the Worker on :8787

make seed-social             #    demo profiles + comments + watchlist (off-chain, via the API)
cp web/.env.example web/.env # set VITE_USE_ANVIL=1 + the two deployed addresses (deterministic anvil)
make web-dev                 # 5) app on :5173
```

The indexer's `/admin/*` endpoints require `Authorization: Bearer ${ADMIN_TOKEN}` (set in
`indexer/wrangler.toml`); the cron triggers indexing automatically in production.

Open http://localhost:5173 — claim a word, see it on your profile, list it, buy it from another
wallet, watch it climb the leaderboard. Connect any of the default anvil accounts (they're the
default whitelist).

## Tests

```bash
make test          # shared (TS parity) + contracts (forge) + indexer (vitest)
```

- **contracts** — unit + invariant + normalization-parity + Merkle-tooling tests; **100% line
  coverage** on all three contracts. Invariants proven over thousands of randomized calls:
  uniqueness, reserved-never-claimable, claim-limit-not-bypassable, all-holders-whitelisted,
  marketplace solvency.
- **shared** — normalization vectors + collision correctness (same fixture as the Solidity suite).
- **indexer** — idempotency, reorg replay, reconciliation drift-correction, and API shape, backed by
  `node:sqlite` (D1-compatible). Plus an opt-in live test against a running anvil.
- **e2e (Playwright)** — full flow against the local stack: claim → profile → list → buy from a
  second account → leaderboard. The headless wallet forwards to anvil (unlocked accounts auto-sign).
  ```bash
  # with chain + indexer + web running (and a fresh deploy + seed):
  cd web && npx playwright install chromium && npm run e2e
  ```
- **CI** (`.github/workflows/ci.yml`) runs all of the above plus **Slither** (`fail-on: medium`),
  `forge coverage`, and gas snapshots.

## Deploy to Base Sepolia

```bash
cp .env.example .env          # fill DEPLOYER_PRIVATE_KEY (testnet!), PROTOCOL_FEE_RECEIVER, RPC
cd contracts/tools && node merkle.mjs whitelist.txt   # your real allowlist -> root + proofs
cd .. && forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast -vvvv
# then point indexer/wrangler.toml [vars] + web/.env at the deployed addresses.
```

## HUMAN TASKS (not automated — `TODO(operator)` markers in code)

1. **Secrets / accounts** — RPC URL, WalletConnect project id, Cloudflare account + D1 + R2, deployer
   key. Fill `.env` / `web/.env` / `indexer/wrangler.toml`. Nothing is hardcoded or fabricated.
2. **Deployer key + multisig** — provide a testnet deployer key; mainnet keys and the owner multisig
   (Safe) are operator-only and out of scope. Contract `owner()` should become the multisig.
3. **Reserved list** — supply the real words to ban (brands, names, trademarks, slurs). Deploy seeds
   one example (`bitcoin`); load the rest via `setReservedBatch`.
4. **Whitelist addresses** — supply the closed-beta allowlist. The Merkle plumbing + `merkle.mjs`
   root/proof generator ship here; the addresses are yours. Default state is closed
   (`whitelistEnabled = true`).
5. **Protocol fee receiver** — placeholder only; set the real address.
6. **Mainnet deploy** — out of scope. Testnet only.
7. **Audit, legal/securities review, brand/visual taste, growth** — all human, all out of scope. The
   v2 bonding-curve layer is gated behind these. The UI ships a clean neutral theme retunable via the
   CSS variables in `web/src/index.css`.
