import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { usePrivy, useFundWallet } from "@privy-io/react-auth";
import { baseSepolia } from "wagmi/chains";
import { isAddress, parseEther, formatEther, type Address } from "viem";
import { activeChain } from "../wagmi";
import { PRIVY_ENABLED, ADDRESSES_READY } from "../config";
import { marketplaceAddress, deedMarketplaceAbi } from "../contracts";
import { Avatar } from "./Avatar";
import { Button, Spinner } from "./ui";
import { useToast } from "./Toast";
import { shortAddr, friendlyError, ethLabel } from "../lib/format";
import { useReceiptError } from "../hooks/useReceiptError";

const FAUCET_URL = "https://portal.cdp.coinbase.com/products/faucet?network=base-sepolia";

// ── app-level mount ─────────────────────────────────────────────────────────
// The panel must NOT render inside the sticky header: its backdrop-filter makes
// the header a containing block for fixed descendants (the "fullscreen" panel
// would be squashed into the header strip), and closing the mobile menu would
// unmount the panel mid-send. So the open state lives in this provider, mounted
// once near the app root, and buttons anywhere call `useWalletPanel().open()`.
const WalletPanelCtx = createContext<{ open: () => void }>({ open: () => {} });

export function useWalletPanel() {
  return useContext(WalletPanelCtx);
}

export function WalletPanelProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const { address } = useAccount();

  // Disconnecting while the panel is open -> close it.
  useEffect(() => {
    if (!address) setIsOpen(false);
  }, [address]);

  return (
    <WalletPanelCtx.Provider value={{ open: () => setIsOpen(true) }}>
      {children}
      {isOpen && address && <WalletPanel address={address} onClose={() => setIsOpen(false)} />}
    </WalletPanelCtx.Provider>
  );
}

/** Account wallet panel: balance, deposit (on-ramp / receive), send (withdraw),
    and — for the Privy embedded wallet — export to another wallet. Reachable from
    the account menu. Send is irreversible, so it goes through a review step. */
function WalletPanel({ address, onClose }: { address: Address; onClose: () => void }) {
  const toast = useToast();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Refetch while open: the panel can sit open across a trade/claim and must not
  // show a stale balance in a money UI.
  const { data: bal } = useBalance({ address, query: { refetchInterval: 12_000 } });
  const balanceEth = bal ? Number(formatEther(bal.value)) : 0;
  const isTestnet = activeChain.id === baseSepolia.id;
  const explorer = activeChain.blockExplorers?.default?.url;

  async function copyAddress() {
    try {
      // No optional chaining: clipboard undefined must land in catch, not report
      // a false "copied" for the deposit-address path.
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(address);
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

        <MarketplaceProceeds address={address} />

        <SendOrReview
          balWei={bal?.value ?? 0n}
          balanceEth={balanceEth}
          explorer={explorer}
          toastClose={onClose}
        />

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

/**
 * Deed-sale proceeds (and buy-overpayment refunds) sit in the marketplace as a
 * pull balance — the contract never pushes ETH. Without this section that money
 * was simply unreachable from the app. Hidden at zero.
 */
function MarketplaceProceeds({ address }: { address: Address }) {
  const toast = useToast();
  const { data: pending, refetch } = useReadContract({
    address: marketplaceAddress,
    abi: deedMarketplaceAbi,
    functionName: "pendingWithdrawals",
    args: [address],
    query: { enabled: ADDRESSES_READY, refetchInterval: 15_000 },
  });
  const owed = (pending as bigint | undefined) ?? 0n;

  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useReceiptError(receipt, "The withdrawal");
  useEffect(() => {
    if (receipt.isSuccess) {
      toast.success("Withdrawn to your wallet");
      void refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  if (owed <= 0n) return null;
  const busy = isPending || receipt.isLoading;

  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-4">
      <div>
        <p className="text-xs text-muted">Marketplace proceeds</p>
        <p className="text-base font-semibold tabular-nums">{ethLabel(owed)}</p>
      </div>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() =>
          writeContract(
            {
              address: marketplaceAddress,
              abi: deedMarketplaceAbi,
              functionName: "withdraw",
              chainId: activeChain.id,
            },
            { onError: (e) => toast.error(friendlyError(e)) },
          )
        }
      >
        {busy ? <Spinner /> : "Withdraw"}
      </Button>
    </div>
  );
}

/** Send (withdraw) form with a review step before the irreversible send. */
function SendOrReview({
  balWei,
  balanceEth,
  explorer,
  toastClose,
}: {
  balWei: bigint;
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
  // Validate in wei (exact), not floats — float compare misjudges near-max sends.
  const amountWei = (() => {
    try {
      return parseEther(amount);
    } catch {
      return null;
    }
  })();
  // Gas is paid on top, so a full-balance send always dies at estimation. Keep a
  // small headroom (generous for an L2 transfer) so "send everything" fails here
  // with words instead of later with a raw RPC error.
  const GAS_HEADROOM = parseEther("0.00001");
  const needsGasRoom =
    amountWei !== null && amountWei > 0n && amountWei <= balWei && amountWei + GAS_HEADROOM > balWei;
  const amountValid =
    amount !== "" &&
    amountWei !== null &&
    amountWei > 0n &&
    amountWei + GAS_HEADROOM <= balWei;
  const canReview = toValid && amountValid;

  function reset() {
    setTo("");
    setAmount("");
    setReview(false);
    setOpen(false);
  }

  function doSend() {
    // parseEther throws on inputs like ">18 decimals" — surface it, don't die silently.
    let value: bigint;
    try {
      value = parseEther(amount);
    } catch {
      toast.error("Invalid amount.");
      setReview(false);
      return;
    }
    sendTransaction(
      { to: to as Address, value, chainId: activeChain.id },
      {
        onSuccess: (hash) => {
          // The hash means submitted, not confirmed — don't overstate it.
          toast.success("Submitted — track it on the explorer");
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
                {amountWei !== null && amountWei > balWei
                  ? "More than your balance."
                  : needsGasRoom
                    ? "Leave a little for gas."
                    : "Enter an amount."}
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
  // Export applies to THIS panel's wallet: it must be the Privy embedded one, not
  // just "the user has an embedded wallet somewhere" while MetaMask is active.
  const isEmbedded =
    user?.wallet?.walletClientType === "privy" &&
    user.wallet.address?.toLowerCase() === address.toLowerCase();

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
  // Nothing to show (testnet + external wallet) -> render nothing, not an empty row.
  if (isTestnet && !isEmbedded) return null;
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
