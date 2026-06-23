# Demo script + outreach (Base)

## A. 60–90 second demo path (what to click, in order)

> Goal: prove it's a *real, live, working launchpad* with the novel "deed earns fees" twist —
> in under 90 seconds. Do this end-to-end on a **fresh wallet** before you record/share.

1. **Land on the home page.** Point at the **live activity ticker + counters** — "every
   line here is a real on-chain event on Base." (This is why seeding real activity first matters.)
2. **Type a word in the claim box.** Show the live availability check (valid / taken / reserved).
3. **Claim it (one tap).** "That single tx minted a 1-of-1 deed *and* deployed this word's
   token market." Show the success → the new word page.
4. **On the word page:** show the **live price chart**, the **buy/sell box** (point at the
   slippage control), and the **"deed owner earns fees" chip**.
5. **Buy a little of *someone else's* word token.** Watch the price tick and the activity
   feed update live. "Anyone can own a *piece* of a word via its token —"
6. **— "but only one person owns the word itself."** Show the **For-sale strip**: a deed
   listed for sale. "And that deed is tradable, because it's a claim on all future fees."
7. **Punchline:** *"One word, one owner, forever — and the owner earns every time the world
   trades it."*

**If asked about safety, in one breath:** fee-flow not a token bag (no dev dump); graduation
freezes buys but keeps sells open (no LP to rug); solvency is fuzz-proven; mainnet is gated on
a pro audit. (Full detail: `SECURITY.md`.)

---

## B. Warm outreach message (short — DM / first touch)

> Hey [name] — been heads-down building **wordsmash** on Base and wanted you to be early on it.
>
> Pitch in two lines: you claim a globally-unique **word** → one tx mints a 1-of-1 **deed NFT**
> *and* spins up a **per-word token** on a bonding curve, and the **deed owner earns a cut of
> every trade** of that word. Pump.fun liveness, but the asset is a *scarce, cash-flowing deed*
> instead of a throwaway meme — and because graduation freezes buys / keeps sells open, **there's
> no LP to rug.**
>
> It's **live on Base Sepolia right now** (full launchpad + indexer): [link]
> 76/76 contract tests, internal audit clean, heading into a pro audit before mainnet.
>
> Could I grab **15 min** for your read on ecosystem fit? And if you can point me to an **audit
> partner** you trust, that'd unblock our mainnet path. 60-sec demo: [clip]

---

## C. Follow-up (with the one-pager attached, if they bite)

> Thanks [name]! One-pager attached (`base-onepager.md`). Quick context on where we are and what
> would actually help:
>
> - **Live now:** Base Sepolia — claim a word, trade its token, list a deed. [link]
> - **Deliberately *not* on mainnet yet:** money paths wait for a professional audit + legal. I'd
>   rather under-promise here.
> - **Most useful from Base, in order:** (1) intro to an audit partner; (2) 15 min of positioning
>   feedback; (3) a path to an ecosystem spotlight / grant as we approach mainnet.
>
> Open to whatever slot works — and happy to walk the demo live.

---

### Honesty guardrails (don't torch credibility with a technical team)
- Say **"testnet live, mainnet gated on audit"** — never imply it's handling real funds.
- Don't claim a third-party audit; say **"internal audit complete, pro audit next."**
- Lead with the **working launchpad + the deed-fee mechanic**, not the art/concept angle.
- Make sure the link shows **real activity** before you send it (run `tools/seed-demo.sh`).
