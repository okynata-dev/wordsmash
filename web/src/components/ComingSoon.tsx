import { useEffect, useState } from "react";

const HOST = "wordsmash.pages.dev";

/** Same normalization as the claim flow: a–z0–9, max 30. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 30);
}

/**
 * Public landing shown on the deployed site before contracts are wired (prod only;
 * dev keeps the AddressGate). The point isn't to explain the mechanics — it's to
 * make you want a word: type one and it becomes yours, leave a note to be first,
 * or share it. Backed only by a same-origin /api/waitlist Pages Function.
 */
export function ComingSoon() {
  const [raw, setRaw] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [contact, setContact] = useState("");
  const [notified, setNotified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const word = normalize(raw);

  // Social proof — only shown once it's a number worth showing.
  useEffect(() => {
    fetch("/api/waitlist")
      .then((r) => r.json())
      .then((d) => setCount(typeof d?.count === "number" ? d.count : null))
      .catch(() => {});
  }, []);

  async function notify() {
    if (!word) return;
    setBusy(true);
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, contact: contact.trim() }),
      });
      const d = await r.json().catch(() => ({}));
      if (typeof d?.count === "number") setCount(d.count);
      setNotified(true);
    } catch {
      setNotified(true); // never block the moment on a network hiccup
    } finally {
      setBusy(false);
    }
  }

  function share() {
    const text = word ? `I’m claiming the word “${word}”.` : `Claim a word. Own it forever.`;
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

  function reset() {
    setClaimed(false);
    setNotified(false);
    setRaw("");
    setContact("");
  }

  const accentBtn =
    "rounded-lg bg-accent px-5 py-2.5 text-[15px] font-medium text-accent-fg transition hover:opacity-90 disabled:opacity-40";

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="px-6 py-5">
        <span className="text-lg font-semibold tracking-tight">wordsmash</span>
      </header>

      <main className="mx-auto flex w-full max-w-[620px] flex-1 flex-col items-center justify-center px-6 pb-24 text-center">
        <h1 className="fade-up text-balance text-4xl font-semibold leading-[1.04] tracking-tight sm:text-[56px]">
          Claim {word ? <span className="break-all text-accent">“{word}”</span> : "a word"}.
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
              <button type="submit" disabled={!word} className={`shrink-0 ${accentBtn}`}>
                Claim
              </button>
            </form>

            <p className="fade-up mt-4 text-sm text-muted" style={{ animationDelay: "100ms" }}>
              {word ? `Only one “${word}” will ever exist.` : "One word, one owner."}
            </p>
          </>
        ) : notified ? (
          <div className="fade-up mt-9 flex w-full max-w-[440px] flex-col items-center gap-4">
            <p className="text-base text-muted">
              You’re in. We’ll reach out the moment{" "}
              <span className="font-medium text-fg">“{word}”</span> can be claimed.
            </p>
            <div className="flex items-center gap-3">
              <button onClick={share} className={accentBtn}>
                {copied ? "Copied" : "Share it"}
              </button>
              <button onClick={reset} className="text-sm text-muted transition hover:text-fg">
                claim another
              </button>
            </div>
          </div>
        ) : (
          <div className="fade-up mt-9 flex w-full max-w-[440px] flex-col items-center gap-4">
            <p className="text-base text-muted">
              Be first to claim <span className="font-medium text-fg">“{word}”</span> when wordsmash opens.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void notify();
              }}
              className="flex w-full items-center gap-2 rounded-xl border border-border bg-surface p-2 pl-4 shadow-sm"
            >
              <label htmlFor="cs-contact" className="sr-only">
                Email or handle
              </label>
              <input
                id="cs-contact"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="email or @handle"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="caret-fg min-w-0 flex-1 bg-transparent text-left text-base outline-none placeholder:text-faint"
              />
              <button type="submit" disabled={busy} className={`shrink-0 ${accentBtn}`}>
                {busy ? "…" : "Notify me"}
              </button>
            </form>
            <div className="flex items-center gap-3">
              <button onClick={share} className="text-sm text-muted transition hover:text-fg">
                {copied ? "copied" : "or just share it"}
              </button>
              <button onClick={reset} className="text-sm text-muted transition hover:text-fg">
                try another
              </button>
            </div>
          </div>
        )}

        {count !== null && count >= 25 && !claimed && (
          <p className="fade-up mt-6 text-xs text-faint" style={{ animationDelay: "140ms" }}>
            {count.toLocaleString()} words already spoken for
          </p>
        )}
      </main>

      <footer className="px-6 py-6 text-center text-xs text-faint">Launching on Base</footer>
    </div>
  );
}
