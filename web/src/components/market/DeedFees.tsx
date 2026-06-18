import { useEffect } from "react";
import type { Address } from "viem";
import { useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { wordMarketAbi } from "../../contracts";
import { Button, Card, Spinner } from "../ui";
import { useToast } from "../Toast";
import { ethLabel, friendlyError } from "../../lib/format";
import { useSyncAfterTx } from "../../hooks/useSyncAfterTx";

/**
 * Deed-holder cash-flow hook. Rendered only when the connected wallet is the deed
 * owner: shows the accrued trade-fee share and a Claim button that withdraws it
 * (claimFees, deed-owner-gated on-chain). Hidden entirely when nothing is accrued.
 */
export function DeedFees({
  market,
  word,
  feesWei,
  onClaimed,
}: {
  market: Address;
  word: string;
  feesWei: bigint;
  onClaimed: () => void;
}) {
  const toast = useToast();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });
  const { sync, syncing } = useSyncAfterTx();

  useEffect(() => {
    if (isSuccess) {
      toast.success("Fees claimed");
      void sync([["word", word]]).then(onClaimed);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess]);

  const busy = isPending || confirming || syncing;
  const hasFees = feesWei > 0n;

  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p className="text-xs text-muted">Your deed-holder fees</p>
        <p className="text-lg font-semibold tabular-nums">{ethLabel(feesWei)}</p>
      </div>
      <Button
        variant="outline"
        disabled={!hasFees || busy}
        onClick={() =>
          writeContract(
            {
              address: market,
              abi: wordMarketAbi,
              functionName: "claimFees",
            },
            {
              onError: (e) => toast.error(friendlyError(e)),
              onSuccess: () => toast.info("Claiming… confirm in your wallet"),
            },
          )
        }
      >
        {busy ? (
          <>
            <Spinner /> {syncing ? "Syncing…" : "Claiming…"}
          </>
        ) : hasFees ? (
          "Claim fees"
        ) : (
          "No fees yet"
        )}
      </Button>
    </Card>
  );
}
