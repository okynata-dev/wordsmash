# Design — lessons from existing launchpads, applied

wordsmash is designed against the *known* failure modes of pump.fun and other launchpads, not just
the happy path. This document maps each real-world problem to how the system handles it. (Testnet
prototype — a professional audit is still required before real funds; see the end.)

## 1. No privileged access to curve funds — the #1 lesson

**What happened elsewhere:** pump.fun lost ~$1.9M when a *former employee who still had admin
privileges* used the protocol's **withdrawal authority** over the bonding curve (plus flash loans)
to drain liquidity meant for migration. The root cause was a privileged key that could touch curve
funds at all. ([The Defiant](https://thedefiant.io/news/hacks/attacker-abuses-flashloans-to-exploit-pump-fun),
[The Block](https://www.theblock.co/post/294959/solana-token-launcher-pump-fun-suffers-flash-loan-exploit))

**wordsmash:** `WordMarket` has **no admin at all** — it is not `Ownable`, has no withdraw-authority,
no pause, no upgrade, no `delegatecall`/`selfdestruct`. The curve's ETH (`realEthReserve`) can leave
**only** via a user's own `sell()`. The registry owner (even a compromised one) cannot extract a
single wei of any market's liquidity. Fees accrue to *separate* pots and only their designated
recipient can pull their own pot. This is enforced structurally (there is no function to abuse) and
proven by the `invariant_marketAlwaysSolvent` fuzz test (4096 random ops) and
`test_OwnerCannotTouchCurveFunds`. Flash loans don't help an attacker because there is no privileged
path to front-run into.

## 2. Anti-rug by construction

**Problem:** rug pulls where a creator pulls the liquidity pool.

**wordsmash:** there *is* no pullable LP during the curve phase — liquidity lives inside the curve
contract and only moves when a user sells or the market graduates. The creator/deed-owner earns a
share of **fees** but can never touch principal. No team pre-allocation: 100% of supply starts in the
curve, same price for everyone. Word uniqueness + a claim fee + the closed-beta whitelist also keep
the spam-token flood (pump.fun's biggest UX problem) in check.

## 3. Sniping / MEV at launch

**What happens elsewhere:** bots snipe the launch block — 15,000+ pump.fun tokens were sniped by
funded wallets in the launch block (~1.75% of supply), and viral launches push priority-fee floors
10–50× as searchers race. ([Bitget](https://www.bitget.com/news/detail/12560604803448),
[RPC Fast](https://rpcfast.com/blog/how-to-launches-snipe-pump))

**wordsmash today:** the closed-beta whitelist means only vetted wallets can claim or trade, which
removes the open-mempool sniper swarm for the beta. **Roadmap for public launch** (designed, not yet
on by default to keep the audited core stable):
- **Commit–reveal claims** so a word can't be sniped out of the mempool (already documented in
  `WordRegistry.claim`).
- **Anti-snipe window**: an optional per-tx buy cap for the first N seconds after a market launches,
  so no single wallet can grab a huge cheap early allocation. (Config-gated, default off.)
- Slippage bounds (`minTokensOut`/`minEthOut`) are already enforced on every trade.

## 4. Graduation / DEX migration

**Elsewhere:** pump.fun graduates at ~$69k market cap, moving locked liquidity into a DEX pool; the
migration step itself has historically been the riskiest moment. ([Yahoo/Decrypt](https://finance.yahoo.com/news/solana-meme-coin-factory-pump-182856555.html))

**wordsmash today:** crossing the real-ETH threshold flips `graduated` and **freezes buys** — but
**selling stays open forever**, so holders can always exit and no ETH is ever stranded. This
deliberately avoids two failure modes a full freeze would create (both flagged in our security
audit): permanently locked `realEthReserve`, and *force-graduation griefing* (a whale crossing the
threshold to trap everyone else's exit). **Roadmap:** a permissionless `migrate()` that pairs
`realEthReserve` + the remaining curve tokens into a Base DEX (e.g. Aerodrome/Uniswap v3) position
with the **LP locked/burned**, callable by anyone once graduated (no privileged migrator → no repeat
of the pump.fun migration-authority risk). Until that exists, "buys frozen, exits always open" is the
safe interim.

## 5. Manipulation-resistant ranking

**Problem:** wash trading inflates volume to game "trending" leaderboards.

**wordsmash:** the leaderboard exposes both deed-sale volume and token-trading volume, but volume is
inherently gameable. The honest mitigations (roadmap): rank/także surface **unique holders** and
**unique traders** (harder to fake than volume), and dampen self-trades. Documented as a known limit
rather than pretended away.

## 6. Centralization & key management

**Lesson from the exploit:** admin keys must be a multisig, and critical params should be
immutable/timelocked.

**wordsmash:** the only admin is the registry owner, scoped to non-fund operations (reserved list,
whitelist root/flag, claim fee, future curve config). It **cannot** touch any market's funds (§1).
For production the owner must be a **multisig (Safe)** — a HUMAN TASK — and the per-market curve
parameters are **immutable after deploy** (set once at clone init; the owner can only change config
for *future* claims, never existing markets).

## Rounding / solvency / reentrancy

The classic curve bugs (rounding that lets a user extract a wei more; reentrancy on the ETH send;
fee accounting that double-spends the reserve) are addressed directly: ceiling division so the curve
constant never decreases, `nonReentrant` + checks-effects-interactions on every ETH path, separate
fee accumulators, and a fuzzed solvency invariant. See `WordMarket.t.sol` / `MarketInvariants.t.sol`.

## Still required before real money (not optional)
- **Professional security audit** of the contracts.
- **Legal/securities review** (bonding-curve token sales carry real regulatory exposure).
- Owner → **multisig**, and turning on the public-launch anti-snipe/commit-reveal paths above.
- These are deliberately gated; the testnet prototype is for demonstration, not real funds.
