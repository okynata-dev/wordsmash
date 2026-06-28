import { useState } from "react";
import { useBalance, useSendTransaction } from "wagmi";
import { usePrivy, useFundWallet } from "@privy-io/react-auth";
import { baseSepolia } from "wagmi/chains";
import { isAddress, parseEther, formatEther, type Address } from "viem";
import { activeChain } from "../wagmi";
import { PRIVY_ENABLED } from "../config";
import { Avatar } from "./Avatar";
import { Button, Spinner } from "./ui";
import { useToast } from "./Toast";
import { shortAddr, friendlyError } from "../lib/format";

const FAUCET_URL = "https://www.alchemy.com/faucets/base-sepolia";

/** Account wallet panel: balance, deposit (on-ramp / receive), send (withdraw),
    and — for the Privy embedded wallet — export to another wallet. Reachable from
    the account menu. Send is irreversible, so it goes through a review step. */
export function WalletPanel({ address, onClose }: { address: Address; onClose: () => void }) {
  const toast = useToast();
  const { data: bal } = useBalance({ address });
  const balanceEth = bal ? Number(formatEther(bal.value)) : 0;
  const isTestnet = activeChain.id === baseSepolia.id;
  const explorer = activeChain.blockExplorers?.default?.url;

  async function copyAddress() {
    try {
      await navigator.clipboard?.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn’t copy address");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Wallet"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold tracking-tight">Wallet</h2>
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

        {/* Balance */}
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-4">
          <Avatar address={address} size={40} />
          <div className="min-w-0">
            <div className="text-2xl font-semibold tabular-nums leading-none">
              {balanceEth.toLocaleString(undefined, { maximumFractionDigits: 5 })}{" "}
              <span className="text-base font-medium text-muted">ETH</span>
            </div>
            <button
              onClick={copyAddress}
              className="mt-1 inline-flex items-center gap-1 text-xs text-faint transition hover:text-fg"
              title="Copy address"
            >
              {shortAddr(address)} · {activeChain.name}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h8" />
              </svg>
            </button>
          </div>
        </div>

        <SendOrReview address={address} balanceEth={balanceEth} explorer={explorer} toastClose={onClose} />

        {PRIVY_ENABLED && (
          <PrivyWalletActions address={address} isTestnet={isTestnet} />
        )}

        {isTestnet && (
          <a
            href={FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 block text-center text-xs text-faint hover:text-fg"
          >
            On a testnet — grab free test ETH from the Base Sepolia faucet ↗
          </a>
        )}
      </div>
    </div>
  );
}

/** Send (withdraw) form with a review step before the irreversible send. */
function SendOrReview({
  address,
  balanceEth,
  explorer,
  toastClose,
}: {
  address: Address;
  balanceEth: number;
  explorer?: string;
  toastClose: () => void;
}) {
  const toast = useToast();
  const { sendTransaction, isPending } = useSendTransaction();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [review, setReview] = useState(false);

  const toValid = isAddress(to);
  const amountNum = Number(amount);
  const amountValid = amount !== "" && amountNum > 0 && amountNum <= balanceEth;
  const canReview = toValid && amountValid;

  function reset() {
    setTo("");
    setAmount("");
    setReview(false);
    setOpen(false);
  }

  function doSend() {
    sendTransaction(
      { to: to as Address, value: parseEther(amount) },
      {
        onSuccess: (hash) => {
          toast.success("Sent");
          reset();
          toastClose();
          if (explorer) window.open(`${explorer}/tx/${hash}`, "_blank", "noopener");
        },
        onError: (e) => toast.error(friendlyError(e)),
      },
    );
  }

  if (!open) {
    return (
      <div className="flex gap-2">
        <Button className="flex-1" onClick={() => setOpen(true)}>
          Send
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!review ? (
        <>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted">Recipient address</label>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x…"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-fg/40"
            />
            {to !== "" && !toValid && (
              <p className="mt-1 text-xs text-negative">Not a valid address.</p>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-baseline justify-between">
              <label className="text-xs font-medium text-muted">Amount (ETH)</label>
              <span className="text-xs text-faint">
                Available {balanceEth.toLocaleString(undefined, { maximumFractionDigits: 5 })}
              </span>
            </div>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0.0"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-fg/40"
            />
            {amount !== "" && !amountValid && (
              <p className="mt-1 text-xs text-negative">
                {amountNum > balanceEth ? "More than your balance." : "Enter an amount."}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={reset}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={!canReview} onClick={() => setReview(true)}>
              Review
            </Button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-surface-2 p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-muted">Send</span>
              <span className="font-semibold tabular-nums">{amount} ETH</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted">To</span>
              <span className="font-mono text-xs">{shortAddr(to)}</span>
            </div>
            <p className="mt-3 text-xs text-faint">
              This is irreversible. Network gas is paid on top from your balance.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setReview(false)} disabled={isPending}>
              Back
            </Button>
            <Button className="flex-1" onClick={doSend} disabled={isPending}>
              {isPending ? (
                <>
                  <Spinner /> Sending…
                </>
              ) : (
                "Confirm send"
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Privy-only actions: fiat/transfer deposit + export the embedded wallet. */
function PrivyWalletActions({ address, isTestnet }: { address: Address; isTestnet: boolean }) {
  const toast = useToast();
  const { user, exportWallet } = usePrivy();
  const { fundWallet } = useFundWallet();
  const [busy, setBusy] = useState<"deposit" | "export" | null>(null);
  const isEmbedded = user?.wallet?.walletClientType === "privy";

  async function onDeposit() {
    setBusy("deposit");
    try {
      await fundWallet({ address });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  async function onExport() {
    setBusy("export");
    try {
      await exportWallet({ address });
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  // On a testnet there's no fiat on-ramp — funding is the faucet + receiving to the
  // address (shown above). So only offer Deposit (on-ramp / transfer) on mainnet.
  return (
    <div className="mt-2 flex gap-2">
      {!isTestnet && (
        <Button variant="outline" className="flex-1" onClick={onDeposit} disabled={busy !== null}>
          {busy === "deposit" ? <Spinner /> : "Deposit"}
        </Button>
      )}
      {isEmbedded && (
        <Button variant="outline" className="flex-1" onClick={onExport} disabled={busy !== null}>
          {busy === "export" ? <Spinner /> : "Export wallet"}
        </Button>
      )}
    </div>
  );
}
