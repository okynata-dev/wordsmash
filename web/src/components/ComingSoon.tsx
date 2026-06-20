import { useState } from "react";

const HOST = "wordsmash.pages.dev";

/** Same normalization as the claim flow: a–z0–9, max 30. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

/**
 * Public landing shown on the deployed site before contracts are wired (prod only;
 * dev keeps the AddressGate). The point isn't to explain the mechanics — it's to
 * make you want a word: type one and it becomes yours, then share it. Zero web3,
 * zero backend, zero fine print.
 */
export function ComingSoon() {
  const [raw, setRaw] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [copied, setCopied] = useState(false);
  const word = normalize(raw);

  function share() {
    const text = word
      ? `I’m claiming the word “${word}”.`
      : `Claim a word. Own it forever.`;
    const url = `https://${HOST}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      nav.share({ text, url }).catch(() => {});
    } else {
      navigator.clipboard?.writeText(`${text} ${url}`).then(
        () => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        },
        () => {},
      );
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">wordsmash</span>
      </header>

      <main className="mx-auto flex w-full max-w-[620px] flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <h1 className="fade-up text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-[56px]">
          Claim{" "}
          {word ? (
            <span className="break-all text-accent">“{word}”</span>
          ) : (
            "a word"
          )}
          .
          <br />
          Own it forever.
        </h1>

        {!claimed ? (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (word) setClaimed(true);
              }}
              className="fade-up mt-9 flex w-full max-w-[440px] items-center gap-2 rounded-xl border border-border bg-surface p-2 pl-4 shadow-sm"
              style={{ animationDelay: "60ms" }}
            >
              <label htmlFor="cs-word" className="sr-only">
                Your word
              </label>
              <input
                id="cs-word"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="your word"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus
                className="word-display caret-fg min-w-0 flex-1 bg-transparent text-left text-xl outline-none placeholder:text-faint sm:text-2xl"
              />
              <button
                type="submit"
                disabled={!word}
                className="shrink-0 rounded-lg bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40"
              >
                Claim
              </button>
            </form>

            <p
              className="fade-up mt-4 text-sm text-muted"
              style={{ animationDelay: "100ms" }}
            >
              {word ? `Only one “${word}” will ever exist.` : "One word, one owner."}
            </p>
          </>
        ) : (
          <div className="fade-up mt-9 flex w-full max-w-[440px] flex-col items-center gap-4">
            <p className="text-base text-muted">
              <span className="font-medium text-fg">“{word}”</span> is yours to claim
              the moment wordsmash opens.
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={share}
                className="rounded-lg bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-fg transition hover:opacity-90"
              >
                {copied ? "Copied" : "Share it"}
              </button>
              <button
                onClick={() => {
                  setClaimed(false);
                  setRaw("");
                }}
                className="text-sm text-muted transition hover:text-fg"
              >
                try another
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="px-6 py-6 text-center text-xs text-faint">
        Launching on Base
      </footer>
    </div>
  );
}
