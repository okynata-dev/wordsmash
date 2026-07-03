# Mainnet launch runbook

The contracts, indexer and web app are **mainnet-ready as code**: every internal-audit
finding is fixed and tested (83 forge tests incl. fuzz/invariants), the same artifacts run
on Base Sepolia right now, and launch is one scripted deploy + config flip. What remains
before pressing the button is **process, not code** — see the human gate below.

## The human gate (do NOT launch without these)

1. **External professional audit** of `contracts/src` (the internal audit in SECURITY.md is
   thorough but not a substitute — real funds need independent eyes).
2. **Multisig ownership.** Deploy from a fresh key, then transfer `owner()` of the registry
   and marketplace to a Safe (2/3 or better — a Ledger works well as one of the signers;
   a bare Ledger-EOA owner is an acceptable solo-founder interim but leaves single-device
   loss and blind-signing phishing as full-admin risks):
   ```
   cast send $REGISTRY "transferOwnership(address)" $SAFE --rpc-url base ...
   cast send $MARKETPLACE "transferOwnership(address)" $SAFE --rpc-url base ...
   ```
3. **PROTOCOL_FEE_RECEIVER** = a hardware wallet you control (Ledger is fine — the role
   only receives money and has zero protocol power) or a treasury multisig. Never a hot
   key. NOTE: each WordMarket clone bakes the receiver in at claim time with no setter —
   keep the seed phrase safe, because fees on already-created markets can only ever be
   claimed by that address (`claimProtocolFees()` must be CALLED by it, one tx per market;
   the registry/marketplace pots are aggregate and rotatable via `setProtocolFeeReceiver`).
4. **Reserved-words list** (brands, trademarks, slurs) loaded via `setReservedBatch` —
   legal/product decision.
5. **Whitelist stance**: launch closed-beta (root from `contracts/tools/merkle.mjs`) or
   open (`setWhitelistEnabled(false)`). NOTE: the whitelist can no longer trap anyone —
   `sell()` and all withdrawals are permissionless by construction.
6. **Legal review** of Terms & risk copy for the target jurisdictions.
7. **Privy production config**: add the production domain in the Privy dashboard;
   consider re-enabling wallet confirmation UIs for value-bearing txs
   (`showWalletUIs`) — the silent-signing trade-off is documented in SECURITY.md.

## The one-button deploy (after the gate)

```bash
# 0) contracts/.env: DEPLOYER_PRIVATE_KEY (fresh key), PROTOCOL_FEE_RECEIVER,
#    BASE_MAINNET_RPC_URL. Never commit; never echo.

# 1) contracts — deploy + verify (writes shared/deployments/<network>.json)
cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_MAINNET_RPC_URL --broadcast --verify

# 2) transfer ownership to the Safe (see the human gate)

# 3) indexer — point at the new deployment and ship
#    edit indexer/wrangler.toml: RPC_URL, REGISTRY, MARKETPLACE, START_BLOCK
#    (values from shared/deployments/base.json), fresh D1 database id for mainnet
cd indexer && npx wrangler deploy

# 4) web — addresses + chain and ship
#    edit web/.env.production: VITE_WORD_REGISTRY, VITE_DEED_MARKETPLACE,
#    VITE_CHAIN=base (mainnet), keep VITE_DEMO_MODE empty
cd web && npx vite build && npx wrangler pages deploy dist --project-name=wordsmash
```

## Post-deploy verification battery

```bash
R=<registry> M=<marketplace> RPC=<mainnet rpc>
cast call $R "claimFee()(uint256)"            --rpc-url $RPC   # 0.001 ether
cast call $R "paused()(bool)"                 --rpc-url $RPC   # false
cast call $R "whitelistEnabled()(bool)"       --rpc-url $RPC   # per launch decision
cast call $R "owner()(address)"               --rpc-url $RPC   # the SAFE, not the deployer
cast call $M "owner()(address)"               --rpc-url $RPC   # the SAFE
cast call $M "FEE_BPS()(uint256)"             --rpc-url $RPC   # 1000 (10%)
```
Then: claim a canary word from a throwaway wallet, buy/sell 0.001 ETH on its curve, claim
the deed fee, list + reprice + confirm `PRICE_CHANGED` on a stale buy, `withdraw()` the
proceeds — the full money loop, with real funds, before announcing.

## Emergency procedures

- **Pause entries** (claims, curve buys, marketplace list/buy):
  `cast send $R "setPaused(bool)" true` (from the Safe). Exits — `sell()`, `claimFees()`,
  `withdraw()`, `withdrawFees()` — CANNOT be paused; user funds are never trapped.
- **Revoke a bad actor** (whitelist mode only): `setWhitelisted(addr, false)` — blocks
  their buys/claims; their sells and withdrawals still work by design.
- Indexer misbehaving: the chain is the source of truth; the web app's money paths read
  prices/listings/market addresses live on-chain (registry-verified) and keep working.

## What was fixed for mainnet (vs. the first testnet deploy)

| Audit finding | Fix (deployed to Base Sepolia 2026-07-03) |
|---|---|
| H-1 owner could freeze exits via whitelist | `sell()` fully ungated — permissionless exit |
| M-1 stale-listing resurrection | marketplace accepts per-token approval ONLY (cleared on every transfer) + public `reap()` |
| M-2 mid-flight reprice hits the buyer | `buy(tokenId, expectedPrice)` reverts `PRICE_CHANGED` |
| M-3 liquidity fee pot stranded ETH forever | folded into `realEthReserve` — deepens the curve, counts to graduation |
| M-4 unclaimed deed fees went to the deed buyer | per-owner accounting `deedFeesOf[owner]` — earnings survive the sale |
| M-5 no emergency stop | `registry.setPaused` gates ALL entries; exits unpausable |
| L volume basis inconsistent | gross on both legs, event == aggregate == indexer |
