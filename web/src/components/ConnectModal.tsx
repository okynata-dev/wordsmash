import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount, useConnect } from "wagmi";
import { friendlyError } from "../lib/format";
import { useToast } from "./Toast";

type Ctx = { open: () => void; close: () => void };
const ConnectModalCtx = createContext<Ctx>({ open: () => {}, close: () => {} });

/** Call `open()` to show the sign-in modal from anywhere (header CTA, hero claim). */
export function useConnectModal() {
  return useContext(ConnectModalCtx);
}

/**
 * One global sign-in modal: a proper centered dialog with a dimmed backdrop (not a
 * dropdown). Lists the available wallets; closes itself the moment a wallet connects.
 * Social login (Google / X / email) is a separate Privy integration — not here yet.
 */
export function ConnectModalProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected } = useAccount();

  // Connecting succeeds elsewhere -> dismiss.
  useEffect(() => {
    if (isConnected) setIsOpen(false);
  }, [isConnected]);

  const value: Ctx = { open: () => setIsOpen(true), close: () => setIsOpen(false) };

  return (
    <ConnectModalCtx.Provider value={value}>
      {children}
      {isOpen && <Dialog onClose={value.close} />}
    </ConnectModalCtx.Provider>
  );
}

function prettyName(name: string): string {
  return name === "Injected" ? "Browser wallet" : name;
}

function Dialog({ onClose }: { onClose: () => void }) {
  const { connectors, connect, isPending } = useConnect();
  const toast = useToast();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // De-dupe connectors by display name (EIP-6963 can surface the same wallet twice).
  const seen = new Set<string>();
  const list = connectors.filter((c) => {
    const key = prettyName(c.name).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight">Sign in</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-md p-1.5 text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <p className="mb-5 text-sm text-muted">Connect a wallet to claim and trade words.</p>

        <div className="flex flex-col gap-2">
          {list.map((c) => (
            <button
              key={c.uid}
              disabled={isPending}
              onClick={() =>
                connect({ connector: c }, { onError: (e) => toast.error(friendlyError(e)) })
              }
              className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-4 py-3 text-left text-[15px] font-medium transition hover:border-[rgb(var(--c-volt))] disabled:opacity-50"
            >
              {prettyName(c.name)}
              <span className="text-xs text-faint">{isPending ? "…" : "Connect"}</span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-center text-xs text-faint">
          Email and social sign-in coming soon.
        </p>
      </div>
    </div>
  );
}
