import { useEffect, useId, useRef, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";
import { activeChain } from "../wagmi";
import { Button } from "./ui";
import { shortAddr, friendlyError } from "../lib/format";
import { useWrongNetwork } from "../hooks/useRegistry";
import { useToast } from "./Toast";

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

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = useWrongNetwork();
  const toast = useToast();
  const { open, setOpen, ref, id } = useDropdown();

  if (isConnected && wrongNetwork) {
    return (
      <Button
        variant="outline"
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

  if (isConnected) {
    return (
      <div className="relative" ref={ref}>
        <Button
          variant="outline"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={id}
          aria-haspopup="menu"
        >
          {shortAddr(address)}
        </Button>
        {open && (
          <div
            id={id}
            role="menu"
            className="absolute right-0 z-20 mt-2 w-44 rounded-lg border border-border bg-surface p-1 shadow-md"
          >
            <button
              role="menuitem"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
              onClick={() => {
                disconnect();
                setOpen(false);
              }}
            >
              Disconnect
            </button>
          </div>
        )}
      </div>
    );
  }

  // Not connected. If only one connector, connect directly; else show a menu.
  if (connectors.length <= 1) {
    const connector = connectors[0];
    return (
      <Button
        onClick={() =>
          connector &&
          connect(
            { connector },
            { onError: (e) => toast.error(friendlyError(e)) },
          )
        }
        disabled={isPending || !connector}
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        onClick={() => setOpen((o) => !o)}
        disabled={isPending}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="menu"
      >
        {isPending ? "Connecting…" : "Connect wallet"}
      </Button>
      {open && (
        <div
          id={id}
          role="menu"
          className="absolute right-0 z-20 mt-2 w-56 rounded-lg border border-border bg-surface p-1 shadow-md"
        >
          {connectors.map((c) => (
            <button
              key={c.uid}
              role="menuitem"
              className="w-full rounded-md px-3 py-2 text-left text-sm hover:bg-surface-2"
              onClick={() => {
                connect(
                  { connector: c },
                  { onError: (e) => toast.error(friendlyError(e)) },
                );
                setOpen(false);
              }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
