import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSwitchChain } from "wagmi";
import { activeChain } from "../wagmi";
import { Avatar } from "./Avatar";
import { WalletPanel } from "./WalletPanel";
import { Button } from "./ui";
import { shortAddr, friendlyError, normAddr } from "../lib/format";
import { useWrongNetwork } from "../hooks/useRegistry";
import { useToast } from "./Toast";
import { useConnectModal } from "./ConnectModal";

/** Dropdown wrapper with Esc + outside-click close and aria wiring. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);
  return { open, setOpen, ref, id };
}

export function WalletButton({ fullWidth = false }: { fullWidth?: boolean } = {}) {
  const w = fullWidth ? "w-full " : "";
  const { address, isConnected } = useAccount();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = useWrongNetwork();
  const toast = useToast();
  const { open: openConnect, signOut } = useConnectModal();
  const { open, setOpen, ref, id } = useDropdown();
  const [walletOpen, setWalletOpen] = useState(false);

  if (isConnected && wrongNetwork) {
    return (
      <Button
        variant="outline"
        className={w}
        onClick={() =>
          switchChain(
            { chainId: activeChain.id },
            { onError: (e) => toast.error(friendlyError(e)) },
          )
        }
        disabled={switching}
      >
        {switching ? "Switching…" : `Switch to ${activeChain.name}`}
      </Button>
    );
  }

  if (isConnected && address) {
    const profilePath = `/profile/${normAddr(address)}`;
    async function copyAddress() {
      try {
        await navigator.clipboard?.writeText(address!);
        toast.success("Address copied");
      } catch {
        toast.error("Couldn’t copy address");
      }
      setOpen(false);
    }
    return (
      <div className={`relative ${w}`} ref={ref}>
        {/* The pill itself is a link to your profile (like the sidebar "Profile");
            the caret opens the account menu (copy / disconnect). */}
        <div className="flex items-center overflow-hidden rounded-xl border border-border bg-surface">
          <Link
            to={profilePath}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-1.5 pr-2 transition hover:bg-surface-2"
          >
            <Avatar address={address} size={22} />
            <span className="truncate font-mono text-[13px]">{shortAddr(address)}</span>
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls={id}
            aria-haspopup="menu"
            aria-label="Account menu"
            className="self-stretch border-l border-border px-2 text-muted transition hover:bg-surface-2 hover:text-fg"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>
        {open && (
          <div
            id={id}
            role="menu"
            className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-border bg-surface p-1 shadow-md"
          >
            <Link
              role="menuitem"
              to={profilePath}
              onClick={() => setOpen(false)}
              className="block rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              View profile
            </Link>
            <button
              role="menuitem"
              onClick={() => {
                setWalletOpen(true);
                setOpen(false);
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              Wallet
            </button>
            <button
              role="menuitem"
              onClick={copyAddress}
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
            >
              Copy address
            </button>
            <button
              role="menuitem"
              onClick={() => {
                signOut();
                setOpen(false);
              }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-negative hover:bg-surface-2"
            >
              Disconnect
            </button>
          </div>
        )}
        {walletOpen && (
          <WalletPanel address={address} onClose={() => setWalletOpen(false)} />
        )}
      </div>
    );
  }

  // Not connected -> open the global sign-in modal (dimmed backdrop, wallet list).
  return (
    <Button
      className={`${w}!border-transparent !bg-[rgb(var(--c-volt))] !text-white`}
      onClick={openConnect}
    >
      Sign in
    </Button>
  );
}
