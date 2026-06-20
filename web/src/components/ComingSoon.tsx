/**
 * Public landing shown on the deployed site before contract addresses are wired
 * (production only — dev still gets the AddressGate with env instructions). Keeps
 * a real *.pages.dev URL looking intentional: brand, value prop, "launching soon"
 * — no nav to gated pages, no indexer calls.
 */
export function ComingSoon() {
  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1120px] items-center gap-2 px-6 py-4">
          <span className="text-lg font-semibold tracking-tight">wordsmash</span>
          <span className="rounded-[5px] bg-surface-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
            Base
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="fade-up mb-6 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[13px] font-medium text-muted">
          <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-positive" />
          Launching soon on Base
        </span>

        <h1 className="fade-up text-balance text-4xl font-semibold leading-[1.05] tracking-tight sm:text-[52px]">
          Claim a word.
          <br />
          Own it forever.
        </h1>

        <p className="fade-up mx-auto mt-5 max-w-[52ch] text-muted" style={{ animationDelay: "60ms" }}>
          Every word can be claimed only once, ever. Claiming mints a 1-of-1 deed —
          global uniqueness enforced on-chain. No images, no descriptions. Just the word.
        </p>

        {/* Decorative claim row — a taste of the product, intentionally inert here. */}
        <div
          className="fade-up mt-8 flex w-full max-w-[460px] items-center gap-2 rounded-xl border border-border bg-surface p-2 pl-4 text-left shadow-sm"
          style={{ animationDelay: "120ms" }}
          aria-hidden
        >
          <span className="word-display min-w-0 flex-1 text-xl text-faint sm:text-2xl">your word</span>
          <span className="shrink-0 rounded-lg bg-accent px-4 py-2 text-[15px] font-medium text-accent-fg opacity-60">
            Claim
          </span>
        </div>

        <p className="fade-up mt-5 text-xs text-faint" style={{ animationDelay: "160ms" }}>
          Closed beta · whitelisted wallets · not an investment product
        </p>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-[1120px] px-6 py-6 text-xs text-faint">
          wordsmash — one word, one owner. Claim what only one will ever own.
        </div>
      </footer>
    </div>
  );
}
