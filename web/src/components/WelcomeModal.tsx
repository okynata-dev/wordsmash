import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
  const enterRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN_KEY)) setOpen(true);
    } catch {
      /* private mode / storage blocked — just don't show it */
    }
  }, []);

  // Move focus into the dialog when it opens (the primary action).
  useEffect(() => {
    if (open) enterRef.current?.focus();
  }, [open]);

  function enter() {
    try {
      localStorage.setItem(SEEN_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  // Esc acknowledges (it's a one-action consent gate); Tab is trapped within the dialog.
  function onKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Escape") {
      enter();
      return;
    }
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
      'a[href], button, input, [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
      onKeyDown={onKeyDown}
    >
      <div
        ref={dialogRef}
        className="fade-up w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center shadow-xl sm:p-8"
      >
        <p className="text-[11px] uppercase tracking-[0.18em] text-faint">Base Sepolia · testnet</p>
        <h2 id="welcome-title" className="mt-3 font-display text-2xl font-semibold tracking-tight">
          Welcome to <span className="text-volt">keepney</span>
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Keep a word and it’s yours. One tap mints a 1-of-1 deed and spins up the word’s own
          token. One word, one owner, forever. You earn every time it trades.
        </p>

        <p className="mt-4 rounded-lg bg-surface-2 px-4 py-3 text-xs leading-relaxed text-muted">
          Experimental software on a test network. Token prices can move fast and go to zero. This
          isn’t financial advice, and you confirm you’re 18+.
        </p>

        <button
          ref={enterRef}
          onClick={enter}
          className="volt-glow mt-5 w-full rounded-xl px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90 active:scale-[0.99]"
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
