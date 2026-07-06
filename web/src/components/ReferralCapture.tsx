// Captures a ?ref=<address> from the URL and, once you connect a wallet, offers a
// one-tap signed confirmation to record who invited you (set-once, server-side).
// Renders a slim banner only when there's a pending, valid, non-self referrer.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAccount, useSignMessage } from "wagmi";
import { isAddress } from "viem";
import { referralMessage } from "@shared/social";
import { api } from "../api";
import { useToast } from "./Toast";
import { Button } from "./ui";
import { shortAddr, friendlyError, normAddr } from "../lib/format";

const PENDING_KEY = "keepney.pendingRef";

export function ReferralCapture() {
  const [params] = useSearchParams();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const toast = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Stash a valid ?ref= so it survives the connect flow / navigation.
  useEffect(() => {
    const ref = params.get("ref");
    if (ref && isAddress(ref)) {
      try {
        localStorage.setItem(PENDING_KEY, ref.toLowerCase());
      } catch {
        /* ignore */
      }
    }
    try {
      setPending(localStorage.getItem(PENDING_KEY));
    } catch {
      setPending(null);
    }
  }, [params]);

  const valid =
    pending &&
    isConnected &&
    address &&
    isAddress(pending) &&
    normAddr(pending) !== normAddr(address);

  if (!valid || dismissed) return null;

  async function accept() {
    if (!address || !pending) return;
    setBusy(true);
    try {
      const timestamp = Date.now();
      const message = referralMessage(address, pending, timestamp);
      const signature = await signMessageAsync({ message });
      await api.setReferrer(address, { referrer: pending, timestamp, signature });
      localStorage.removeItem(PENDING_KEY);
      setPending(null);
      toast.success("Referral recorded — welcome!");
    } catch (e) {
      // 409 = already set; treat as done, not an error.
      const msg = String((e as Error)?.message ?? "");
      if (msg.includes("409") || /already set/i.test(msg)) {
        localStorage.removeItem(PENDING_KEY);
        setPending(null);
      } else {
        toast.error(friendlyError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      /* ignore */
    }
    setDismissed(true);
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
      <span className="text-muted">
        Invited by <span className="font-medium text-fg">{shortAddr(pending!)}</span>? Confirm to
        credit them.
      </span>
      <span className="flex items-center gap-2">
        <Button variant="ghost" onClick={dismiss} disabled={busy}>
          Not now
        </Button>
        <Button onClick={accept} disabled={busy}>
          {busy ? "Confirming…" : "Confirm"}
        </Button>
      </span>
    </div>
  );
}
