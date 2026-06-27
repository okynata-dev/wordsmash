import { useEffect, useId, useRef, useState } from "react";
import { useAccount, useDisconnect, useSwitchChain } from "wagmi";
import { activeChain } from "../wagmi";
import { Button } from "./ui";
import { shortAddr, friendlyError } from "../lib/format";
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
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const wrongNetwork = useWrongNetwork();
  const toast = useToast();
  const { open: openConnect } = useConnectModal();
  const { open, setOpen, ref, id } = useDropdown();

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
