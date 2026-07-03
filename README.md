# keepney

**Every word can be owned exactly once — and it pays its owner on every trade.**

Keeping a word (one tap, 0.001 ETH) mints its **deed** — a unique on-chain title,
`tokenId = keccak256(word)` — and in the same transaction deploys the word's own ERC-20
trading on a bonding curve. From that moment, **0.4% of every buy and sell flows to
whoever holds the deed**. The deed is not a JPEG; it's a cash-flowing claim on a piece of
the namespace, and it can itself be resold on the built-in marketplace.

Live on **Base Sepolia**: [keepney.com](https://keepney.com)

```
type a word ──▶ deed (ERC-721) + token market (ERC-20 on a curve), one tx
   trade    ──▶ 1% fee: 0.4% deed holder · 0.5% protocol · 0.1% deepens the curve
 graduate   ──▶ 10 ETH in the curve freezes buys; selling stays open forever
```

## Why you can't steal anyone's money here

These are structural properties of the contracts, not policies — each enforced by code
and pinned by tests (91 in `contracts/test/`, incl. fuzzing and stateful invariants):

| Guarantee | How |
|---|---|
| **Exits are permissionless** | `sell()`, `claimFees()`, `withdraw()` carry no whitelist, no pause, no owner hook. Nothing — including the admin — can trap a holder's funds. `test_SellIsPermissionless` |
| **No admin path to curve ETH** | `WordMarket` has no owner and no withdraw; reserve ETH only leaves via `sell()`. `test_OwnerCannotTouchCurveFunds` |
| **The curve is always solvent** | Reserve-out math rounds in the contract's favor; `balance ≥ reserve + every fee pot` holds across randomized trade orderings. `invariant_marketAlwaysSolvent` |
| **Earnings survive a deed sale** | Fees accrue per-owner at trade time (`deedFeesOf`); selling the deed moves only future cash flow. `test_UnclaimedFeesSurviveDeedSale` |
| **Buyers pay the price they saw** | Marketplace `buy(tokenId, expectedPrice)` reverts on a mid-flight reprice; the app also re-reads the live listing at click time. `test_RepriceInFlightRevertsBuy` |
| **Stale listings can't resurrect** | Per-token approvals only — ERC-721 clears them on every transfer, so an old listing dies with the deed's movement. `test_StaleListingUnexecutableAndReapable` |
| **Claims can't be mempool-sniped** | Commit-reveal (`commitClaim` → delay → `claimWithCommit`), flag-gated for the open launch. `test_MempoolSniperCannotFrontRunReveal` |
| **A pause can't take hostages** | The emergency switch stops entries (claims, buys, listings) only; every exit stays live. `test_PauseFreezesEntriesNotExits` |
| **Pull-payments everywhere** | Marketplace `buy()` moves no ETH out; proceeds/refunds/fees are credited and withdrawn separately — a reverting recipient can never block trading (the pump.fun lesson). |

The frontend applies the same paranoia: it **does not trust its own API** — market
addresses from the indexer are verified against the on-chain registry before any
value-bearing UI renders, deed buys re-read the live listing at click time, and every
write is chain-pinned. Incident-mapped design notes: [SECURITY.md](SECURITY.md). Launch
runbook + the human gate (external audit, multisig): [MAINNET.md](MAINNET.md).

## Onboarding without the word "wallet"

Sign in with email/Google/X (Privy) → an embedded wallet is created silently → claim,
trade, earn — under a minute. External wallets work too. Profiles, avatars, comments and
watchlists live off-chain behind SIWE-lite signatures (content-bound, replay-protected,
rate-limited); shared message builders keep client and server byte-identical.

## Architecture

```
on-chain events ──▶ indexer (CF Worker → D1) ──▶ REST API ──▶ web app (reads)
        ▲                                                          │
        └──────────────────  wagmi writes (chain-pinned)  ◀────────┘
```

- **Uniqueness**: the registry IS the deed ERC-721; one normalized word → one tokenId, once ever.
- **Normalization**: TS ⇄ Solidity implementations proven byte-identical against a shared
  fixture (`shared/fixtures/normalization-vectors.json`) — non-ASCII rejected (no homoglyphs).
- **Markets**: EIP-1167 clones, virtual-reserve constant-product curve, quotes are
  execution-exact (fee-inclusive, same rounding as the trade path).
- **Charts**: real OHLC candles (TradingView's lightweight-charts engine) fed by the
  indexer's `/candles` aggregation, in its own lazy chunk.
- **Trust surface**: `Holders` and `Positions` are *nominated* by the indexer but every
  displayed number is a live on-chain `balanceOf` read.

```
shared/     normalization + types + generated ABIs + whitelist tooling
contracts/  Foundry: WordRegistry · WordMarket · DeedMarketplace — 91 tests
indexer/    CF Worker: indexer → D1, REST API, OG images, social layer
web/        React + Vite + wagmi/viem + Tailwind
```

## Run it locally

Prereqs: [Foundry](https://book.getfoundry.sh), Node 20+, `jq`.

```bash
make install && make merkle
make chain        # anvil :8545
make deploy       # + writes shared/deployments/anvil.json
make seed         # demo claims/trades/listings
make indexer-dev  # D1 schema + Worker :8787
make web-dev      # app :5173  (cp web/.env.example web/.env first)
```

Tests: `make test` (shared parity + forge + indexer) · e2e: `cd web && npm run e2e` ·
CI runs all of it + Slither (`fail-on: medium`) + coverage + gas snapshots.

## Deploy

Testnet: `forge script script/Deploy.s.sol:Deploy --rpc-url base_sepolia --broadcast`,
then point `indexer/wrangler.toml` and `web/.env.production` at
`shared/deployments/baseSepolia.json`, and reserve the brand list with
`script/Reserve.s.sol`. Mainnet: **[MAINNET.md](MAINNET.md)** — the deploy is one command;
the gate before it (external audit, multisig ownership, reserved words, legal) is human.

> ⚠️ Experimental testnet software. Not an investment product; no returns promised or
> implied. Mainnet is gated on an external audit — do not use with real funds until then.
