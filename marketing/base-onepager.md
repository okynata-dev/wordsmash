# wordsmash — one word, one owner

**Claim a word, own it forever — and earn every time the world trades it.**

---

### What it is (1 line)
wordsmash turns any word into a **1-of-1 ownable on-chain deed** that earns trading
fees from a **per-word token market**. Pump.fun-style liveness — but the asset is a
*scarce, cash-flowing deed* instead of a disposable meme bag.

### The problem
Token launchpads mint infinite throwaway coins: value evaporates, devs dump, LPs get
pulled. Nothing accrues **lasting ownership** or **cash flow** to a creator.

### The mechanic
- Claiming a globally-unique word mints a **1-of-1 deed (ERC-721)** *and* deploys a
  **per-word bonding-curve token (ERC-20)** in the same transaction.
- Anyone can buy/sell that word's token on a virtual-reserve constant-product curve.
- The **~1% trade fee splits protocol / deed-owner / liquidity** — and the deed-owner
  share flows to **whoever currently holds the deed**. So the deed is a **cash-flowing
  asset**, and the secondary market for deeds is a market for *future fee income*.
- **Scarcity:** each word can be claimed **once, ever.**

### Why it's structurally safer (state these as features)
- **Fee-flow, not a token bag** for the creator → the pump.fun dev-dump vector is
  *structurally absent*.
- **Buys-freeze / sells-open graduation** → no external LP is ever handed out →
  **the LP-rug is impossible by construction.**
- **One word, one owner** → a native identity / anti-sybil primitive most launchpads lack.
- Curve solvency is **fuzz-proven**; every ETH path is reentrancy-guarded (CEI);
  slippage min-out is enforced on every trade; owner cannot touch user funds.

### Why Base
- Word-ownership is **natively Farcaster/Base-shaped** — identity, social, "claim your word."
- Cheap, fast, single FCFS sequencer fits an impulsive *type-a-word → claim → trade* UX.
- **Already live on Base Sepolia.**

### Status
- **Live on Base Sepolia** — full launchpad UI + indexer + contracts. → `https://wordsmash.pages.dev`
- **76/76** contract tests green; internal security audit complete — **no critical/high** findings.
- **Mainnet deliberately gated** on a professional audit + legal review. We are not rushing money paths.

### The ask
1. **Intro to an audit partner** you trust in the Base ecosystem — this unblocks our mainnet path.
2. **15 min of feedback** on positioning + ecosystem fit.
3. A path to **ecosystem spotlight / grant** as we approach mainnet.

### Roadmap
- **Now** — closed testnet beta; seed flagship words; tighten the claim→trade loop.
- **Next** — professional audit → mainnet; owner key on hardware wallet.
- **Then** — Farcaster-native claim flow; co-marketed mainnet launch; anti-snipe fair-launch mechanics.

---
*One word, one owner. The person who owns the word earns from everyone who trades it.*
