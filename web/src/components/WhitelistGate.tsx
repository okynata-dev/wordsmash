import { useEffect, type ReactNode } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { registryAddress, wordRegistryAbi } from "../contracts";
import { useIsAllowed, useWhitelistEnabled } from "../hooks/useRegistry";
import { proofFor } from "../whitelist";
import { Button, Card, Spinner } from "./ui";
import { friendlyError } from "../lib/format";
import { useToast } from "./Toast";

/**
 * Wraps claim/buy/list actions. Renders `children` only when the wallet is
 * clear to transact (whitelist disabled, or enabled + allowed). Otherwise shows
 * the appropriate closed-beta state and never a button that would obviously revert.
 *
 * `compact` is for dense lists (e.g. the marketplace) where the full enroll card
 * per row would be noise: it collapses the not-allowed states to a small disabled
 * pill so the action is still never an enabled button that reverts.
 */
export function WhitelistGate({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  const { address, isConnected } = useAccount();
  const { data: enabled, isLoading: loadingEnabled } = useWhitelistEnabled();
  const { data: allowed, isLoading: loadingAllowed, refetch } = useIsAllowed(address);
  const toast = useToast();

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      // Re-check allowance once the enroll tx confirms.
      void refetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  // Not connected -> let the action area render; the action buttons handle connect.
  if (!isConnected) return <>{children}</>;

  if (loadingEnabled || (enabled && loadingAllowed)) {
    if (compact) {
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted">
          <Spinner /> access…
        </span>
      );
    }
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted">
        <Spinner /> Checking access…
      </Card>
    );
  }

  // Whitelist off, or already allowed -> clear to transact.
  if (!enabled || allowed) return <>{children}</>;

  // Whitelist on and NOT allowed.
  if (compact) {
    return (
      <Button disabled title="Closed beta. Your wallet isn’t on the allowlist yet.">
        Closed beta
      </Button>
    );
  }

  // Look for a proof.
  const proof = proofFor(address);

  if (proof) {
    return (
      <Card className="space-y-3 p-4">
        <p className="text-sm text-muted">
          You&apos;re on the closed-beta allowlist. Verify once to start claiming, listing and buying.
        </p>
        <Button
          onClick={() =>
            writeContract(
              {
                address: registryAddress,
                abi: wordRegistryAbi,
                functionName: "verifyWhitelist",
                args: [proof],
              },
              {
                onError: (e) => toast.error(friendlyError(e)),
                onSuccess: () => toast.info("Verifying… confirm in your wallet"),
              },
            )
          }
          disabled={isPending || confirming}
        >
          {isPending || confirming ? (
            <>
              <Spinner /> Enrolling…
            </>
          ) : (
            "Enroll (verify whitelist)"
          )}
        </Button>
      </Card>
    );
  }

  // No proof for this wallet.
  return (
    <Card className="space-y-1 p-4">
      <p className="text-sm font-medium">Closed beta</p>
      <p className="text-sm text-muted">
        Your wallet isn&apos;t on the allowlist yet. Claiming, listing and buying are
        disabled until the beta opens up or your address is added.
      </p>
    </Card>
  );
}
