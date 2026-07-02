import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { usePrivy, useConnectWallet } from "@privy-io/react-auth";
import { PRIVY_ENABLED } from "../config";
import { friendlyError } from "../lib/format";
import { useToast } from "./Toast";

type Ctx = { open: () => void; close: () => void; signOut: () => void };
const ConnectModalCtx = createContext<Ctx>({
  open: () => {},
  close: () => {},
  signOut: () => {},
});

/**
 * `open()` shows the sign-in modal, `signOut()` ends the session. Call from anywhere
 * (header CTA, hero claim). Backed by Privy when an app id is set, otherwise by the
 * built-in wallet dialog below.
 */
export function useConnectModal() {
  return useContext(ConnectModalCtx);
}

export function ConnectModalProvider({ children }: { children: ReactNode }) {
  return PRIVY_ENABLED ? (
    <PrivyConnect>{children}</PrivyConnect>
  ) : (
    <FallbackConnect>{children}</FallbackConnect>
  );
}

/** Privy-backed: `open()` opens Privy's full login modal (email/Google/X + wallets). */
function PrivyConnect({ children }: { children: ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const { connectWallet } = useConnectWallet();
  const value: Ctx = {
    open: () => {
      if (!ready) return;
      if (!authenticated) {
        login();
      } else {
        // Privy session alive but no wagmi wallet (e.g. the external wallet was
        // disconnected on its own side) — reconnect a wallet instead of a dead no-op.
        connectWallet();
      }
    },
    close: () => {},
    signOut: () => {
      void logout();
    },
  };
  return <ConnectModalCtx.Provider value={value}>{children}</ConnectModalCtx.Provider>;
}

/** Fallback (no Privy app id): the original centered wallet dialog. */
function FallbackConnect({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected } = useAccount();
  const { disconnect } = useDisconnect();

  // Connecting succeeds elsewhere -> dismiss.
  useEffect(() => {
    if (isConnected) setIsOpen(false);
  }, [isConnected]);

  const value: Ctx = {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    signOut: () => disconnect(),
  };

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
