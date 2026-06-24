import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const SEEN_KEY = "ws_welcome_v1";

/**
 * First-visit welcome — the brand's warm front door AND the risk acknowledgment in
 * one (pump.fun does the same: "Continue → you agree to terms · 18+"). Shown once,
 * gated on localStorage. Entering records that the user has seen the risk notice.
 * Deliberately the ONLY blocking legal surface — everything else stays clutter-free.
 */
export function WelcomeModal() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* private mode / storage blocked — just don't show it */
    }
  }, []);

  function enter() {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div className="fade-up w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-xl sm:p-8">
        <p className="text-[11px] uppercase tracking-[0.18em] text-faint">Base Sepolia · testnet</p>
        <h2 id="welcome-title" className="mt-3 font-display text-2xl font-semibold tracking-tight">
          Welcome to <span className="text-volt">wordsmash</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Smash a word and it’s yours — one tap mints a 1-of-1 deed and spins up the word’s own
          token. One word, one owner, forever, and you earn every time it trades.
        </p>

        <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
          Experimental software on a test network. Token prices can move fast and go to zero. This
          isn’t financial advice, and you confirm you’re 18+.
        </p>

        <button
          onClick={enter}
          className="volt-glow mt-5 w-full rounded-xl !bg-[rgb(var(--c-volt))] px-4 py-3 text-sm font-medium text-white transition hover:opacity-90 active:scale-[0.99]"
          style={{ backgroundColor: "rgb(var(--c-volt))" }}
        >
          Enter
        </button>

        <p className="mt-3 text-xs text-faint">
          By entering you agree to the{" "}
          <Link to="/legal" onClick={enter} className="underline hover:text-fg">
            terms &amp; risk
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
