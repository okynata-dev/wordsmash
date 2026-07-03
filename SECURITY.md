# Security posture & launchpad-hardening roadmap

This document maps real launchpad incidents and audit-finding classes to wordsmash,
records what the codebase already does, what was hardened in the security pass, and a
prioritized roadmap of the best launchpad innovations to adopt. It is a living checklist,
**not** a substitute for a professional audit (see "Before real funds").

## TL;DR

The contracts already implement the full contract-side checklist surfaced by researching
pump.fun / GemPad / Curves / Truebit / Caviar / Fei / Team Finance incidents and Code4rena
/ OZ / Balancer / DFX finding classes. The real gaps were on the **web edge** (missing HTTP
security headers) and are fixed in this pass. The remaining items are **feature work** (anti-
snipe mechanics) or **audit-gated** (anything touching money paths before mainnet).

## What the code already does right (validated against real incidents)

| Incident / class | Risk | wordsmash status |
|---|---|---|
| GemPad clone-template reentrancy ($2.2M) | one impl bug = every clone | `ReentrancyGuard` + `nonReentrant` on every ETH path; CEI ordering; `test_ReentrancyOnSellBlocked` |
| Caviar `x*y=k` ERC777 buy reentrancy | tokens out before payment settled | effects-before-`_transfer` in `buy`/`sell`; reserve is the contract's own ERC-20 (no external callback token) |
| Truebit price overflow → free mint ($26.6M) | rounding/overflow → 0-cost buy | Solidity 0.8 checked math; `require(tokensOut > 0)` / `require(grossEthOut > 0)`; ceil-division rounds **against** the user so the curve constant never decreases |
| Balancer / DFX rounding-direction drain | round in user's favor bleeds reserves | `invariant_reservesPositive` (k never decreases) + `test_RoundTripCannotProfit` (buy→sell ≤ paid) |
| EIP-1167 uninitialized-clone front-run | attacker seizes a fresh clone | registry clones **and** initializes atomically in `claim` (`nonReentrant`, effects-first); `initialize` guarded by an `initialized` flag + zero-address checks; the logic template itself is **locked in its constructor** (`initialized = true`, OZ `_disableInitializers` hygiene) so it can never be initialized directly |
| Curves FeeSplitter access-control ($) | repoint fee recipient | all fee/config setters `onlyOwner`; deed-holder fee is pull-payment, credited to the holder at accrual |
| pump.fun flash-loan buyout + key compromise | atomic graduation payout; EOA admin key | graduation is a one-way latch with **no** privileged payout; freezes buys, sells stay open (no LP handed out) |
| Honeypot (block sells / freeze) | trap holders | `sell()` has no graduation/pause gate and always honors the curve — holders can **always** exit (`test_GraduationFreezesBuysButSellsStayOpen`) |
| ERC-4626 donation / first-deposit inflation | donate to skew price | pricing uses **virtual + internal-accounting** reserves (state vars), never `address(this).balance` — donations can't move price |
| Sandwich / MEV on buys | no slippage control | mandatory `minTokensOut` / `minEthOut` on `buy`/`sell` |
| Marketplace push-payment DoS / reentrancy | reverting receiver blocks settlement | pull-payment marketplace; `withdraw`/`withdrawFees` `nonReentrant` |
| Signed-write replay | resubmit a captured comment | per-signature `consumed_sigs` guard + timestamp expiry/future-skew; message binds app + action + target + address + `issued` |
| Stored XSS via UGC / SVG avatar | inject script through comments/avatars | UGC rendered as React-escaped text (no `dangerouslySetInnerHTML`); SVG avatar uploads rejected; OG meta is static, not UGC-derived |
| Admin endpoint takeover | open admin write | `Authorization: Bearer` with constant-time compare; refuses if token unset |

Sources for the above incidents/classes are listed at the bottom.

## Hardened in this pass

- **Cloudflare Pages security headers** (`web/public/_headers`): `X-Frame-Options: DENY` +
  CSP `frame-ancestors 'none'` (clickjacking is the #1 wallet-dApp risk — a framed "Sign"
  button is a drainer trigger), `X-Content-Type-Options: nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, HSTS (preload), `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  (keeps wallet popups working), immutable caching for fingerprinted assets.
- **Indexer Worker security headers** (`indexer/src/index.ts`): `nosniff` + `Referrer-Policy`
  + `X-Frame-Options: DENY` on every response, including the served SVG/HTML (stops MIME
  confusion). CORS stays `*` deliberately — public read APIs + cross-origin OG/avatar fetches;
  social writes are authed by signature recovery + replay guard, not by CORS.

## Known design caveats (not vulnerabilities)

- **Liquidity fee is a permanent sink — by design.** The `liquidityBps` share of every trade
  fee (10% of the 1% fee) accrues to `liquidityFeesAccrued` and has **no withdrawal path and is
  never re-injected** into the curve, so that ETH is permanently locked in the market clone.
  This is deliberate: adding any extraction function would create a privileged drain (rug)
  surface, so the fee is left credibly non-extractable until a future DEX-migration design
  decides its fate. Curve solvency is unaffected — `realEthReserve` excludes the fee pots and is
  fully backed (`invariant_marketAlwaysSolvent`). Do **not** "fix" this by adding a withdraw.
- **Admin owner is an EOA on testnet → must be a multisig before mainnet.** All
  fee/whitelist/config setters are `onlyOwner`; none can touch user funds or curve reserves
  (`test_OwnerCannotTouchCurveFunds`), but key compromise would still let an attacker repoint the
  protocol-fee receiver and toggle the whitelist. Migrate `owner()` to a multisig at launch.

## Roadmap — best launchpad innovations to adopt (prioritized)

**Safe to do without touching money paths**
- **Full script/connect CSP** on the SPA once the wallet flow is live: tighten `script-src
  'self'`, `connect-src` to the worker API + RPC + WalletConnect origins; **must** be tested
  against the live wallet connect (a too-strict CSP silently breaks it). Today only
  `frame-ancestors` is set, which can't break anything.
- **EIP-712 typed-data** for social auth (upgrade from the SIWE-lite string): bind `chainId`
  and `verifyingContract`, render a human-readable prompt, add a server-issued single-use
  nonce. Current scheme is sound (app/action/target/timestamp + replay guard) — this is
  defense-in-depth + better UX, not a fix for a live hole.
- **Supply-chain**: `npm ci` + pinned exact versions for wagmi/viem/WalletConnect; the
  Dec-2023 Ledger Connect Kit and Sept-2025 npm attacks turned single poisoned deps into
  drainers in consuming frontends.

**Anti-snipe / fair-launch mechanics — AUDIT-GATED (touch the curve / claim path)**
- **Time-decaying launch fee** (Meteora/Heaven/four.meme): high fee at t=0 decaying over a
  short window. Uniquely good fit here — the extra early-sniper fee routes to the **deed
  holder + liquidity**, turning anti-snipe defense into owner yield.
- **Size-based early-buy surcharge** (Meteora Rate Limiter): convex fee on large early buys to
  stop a single wallet cornering a word.
- **Commit-reveal word claim** (ENS-style) — **DEFERRED, by design**. In theory `claimWord`
  is front-runnable (watch the mempool, claim the word first). But on Base the sequencer is
  single, FCFS, with no public mempool today, so that attack is largely mitigated by the chain
  itself — and commit-reveal would impose a two-transaction, wait-a-block flow on the core
  "type your word, claim it" moment, which is exactly the magic we don't want to add friction
  to. Net: not worth the UX cost now. **Revisit if/when Base exposes a public mempool or
  decentralizes its sequencer** — then commit-reveal becomes high priority.
- **Per-leaf buy cap during the Merkle beta**: the whitelist already gates *who* can buy, so a
  per-address cap is meaningfully sybil-resistant during closed beta.

**Structural advantages already ours (foreground in design/marketing)**
- Deed holder earns **fee flow, not a token bag** → the pump.fun-style dev-dump vector is
  structurally absent.
- Buys-freeze / sells-open graduation → no external LP to pull → the LP-rug is absent by
  construction (state this as a feature).
- "One word, one owner" deed + Merkle beta = native identity / sybil tooling most launchpads lack.

## Internal audit findings — ALL FIXED (2026-07-03 redeploy)

Every contract-level finding below is **fixed, tested (83 forge tests incl. fuzz/invariants)
and deployed to Base Sepolia** (registry `0x7739AEEDaE03118c53CD34e3C084c6cbBf847b87`,
marketplace `0xBC48b7Ddf8837179974A776785b045452C5187B0`). See MAINNET.md for the launch
runbook and the remaining HUMAN gate (external audit, multisig). Original findings kept for
the audit trail:

1. **H: whitelist gates `sell()`** (`WordMarket.sol` sell → `registry.isAllowed`). The owner
   can freeze every holder's ETH exit by revoking whitelist / re-enabling the global gate.
   Exit must be permissionless: drop the check from `sell()`, keep it on `buy()`. Also move
   ownership to a timelocked multisig.
2. **M: marketplace `buy()` takes no `expectedPrice`** — a seller can front-run a buyer's tx
   with `list(tokenId, higherPrice)` and the buy clears at the new price. Add
   `buy(tokenId, expectedPrice)` + `require(l.price == expectedPrice)`. (The web app now
   reads the live listing at click time and pays exactly it — mitigation, not a fix.)
3. **M: stale-listing resurrection** — a listing survives the deed leaving and returning to
   the seller (esp. with a lingering `setApprovalForAll`); old price becomes executable
   again. Require re-list after any ownership change (listing epoch) or add a public
   `reap(tokenId)`.
4. **M: `liquidityFeesAccrued` is a dead pot** — 0.1% of every trade accrues with NO spend
   path; ETH is stranded forever. Either fold it into `realEthReserve` or wire it to the
   graduation/LP-migration path before mainnet.
5. **M: unclaimed deed fees transfer with the deed** — selling the deed without `claimFees()`
   donates the accrued pot to the buyer. Auto-settle to the seller on transfer, or keep as
   documented behavior + UI warning (the web app now warns in the listing flow).
6. **M: no pause switch** — add `Pausable` to `buy()` paths only (`sell()`/`withdraw()`/
   `claimFees()` stay always-live so a pause can never trap funds).
7. **L: `totalEthVolume` basis is inconsistent** — buys add net `ethIn`, sells add gross
   `grossEthOut`, and the `Trade` event emits the opposite basis per leg, so contract vs
   indexer volume drift by ±1% per leg. Pick one basis (emit gross both legs) at redeploy.

Frontend/API fixes shipped in the same pass: per-call `chainId` on every write (wrong-network
sends were possible for external wallets), `useWrongNetwork` reads the live connection chain,
marketplace pull-balance (`pendingWithdrawals`) withdraw UI, live-price check before deed buys,
receipt-revert toasts everywhere, avatar signature now binds `sha256(dataUrl)`, replay guard
canonicalizes signatures (casing + low-s), comment rate limit (20 / 10 min / address).

Open (needs infra): server-side X-handle verification via the Privy API (indexer currently
stores it self-attested with `twitter_verified = 0`; UI no longer says "verified").
`showWalletUIs: false` keeps embedded-wallet signing silent app-wide — deliberate UX trade-off
for testnet; revisit for mainnet (at minimum, show wallet UI for value-bearing txs).

## Before real funds (the v2 boundary)

The per-word bonding-curve trading is **testnet-only** and gated behind a professional audit
and legal review before any mainnet / real funds — anything in the audit-gated list above,
and any LP-migration at graduation (cf. Team Finance $14.5M, Fei spot-price manipulation),
must wait for that. Do not deploy money paths to mainnet on the strength of this checklist alone.

## Sources

Incidents: Truebit ($26.6M, integer overflow) · pump.fun (flash-loan buyout + key compromise)
· GemPad ($2.2M clone reentrancy) · Caviar (Code4rena #343, ERC777 buy reentrancy) · Curves
(Code4rena #1271, FeeSplitter access control) · Team Finance ($14.5M migration) · Fei (spot-
price manipulation, caught pre-launch) · Balancer ($128M rounding) · DFX (rounding/zero-output)
· Ledger Connect Kit & Sept-2025 npm (supply-chain drainers) · wallet-drainer malware (~$500M,
2024) · LinkedIn persistent XSS via Open Graph.
Mechanisms: Meteora Anti-Sniper Suite (fee scheduler, rate limiter) · Heaven decaying tax ·
four.meme "X Mode" · Virtuals Genesis (caps, points) · Moonshot LP burn · EIP-712 / EIP-4361
(SIWE) · OWASP Clickjacking & Web3 Top-15 · RareSkills EIP-1167 init.
