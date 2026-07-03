// Own-profile earnings surface. "You earn on every trade" only lands if the
// money is visible in ONE place: claimable deed fees across every owned word's
// market (one multicall) plus the marketplace pull balance (deed-sale proceeds
// and buy refunds). Hidden entirely when there's nothing to claim.
import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import type { Address } from "viem";
import {
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import type { WordRow } from "@shared/types";
import {
  wordMarketAbi,
  wordRegistryAbi,
  deedMarketplaceAbi,
  marketplaceAddress,
  registryAddress,
} from "../contracts";
import { activeChain } from "../wagmi";
import { asMarketAddress } from "../hooks/useMarket";
import { ADDRESSES_READY } from "../config";
import { Button, Card, Spinner } from "./ui";
import { useToast } from "./Toast";
import { ethLabel, friendlyError } from "../lib/format";
import { useReceiptError } from "../hooks/useReceiptError";

export function EarningsCard({ address, owned }: { address: Address; owned: WordRow[] }) {
  const markets = useMemo(
    () =>
      owned
        .map((w) => {
          try {
            return { word: w.word, market: asMarketAddress(w.market), tokenId: BigInt(w.tokenId) };
          } catch {
            return { word: w.word, market: undefined, tokenId: null };
          }
        })
        .filter(
          (x): x is { word: string; market: Address; tokenId: bigint } =>
            Boolean(x.market) && x.tokenId !== null,
        ),
    [owned],
  );

  // Two reads per word: the accrued fees AND the registry's own record of the
  // word's market. The market address arrives from the INDEXER (API data) but
  // Claim is a silently-signed write — never send it anywhere the on-chain
  // registry doesn't confirm.
  const feeReads = useReadContracts({
    allowFailure: true,
    contracts: markets.flatMap((m) => [
      {
        address: m.market,
        abi: wordMarketAbi,
        functionName: "deedFeesAccrued" as const,
      },
      {
        address: registryAddress,
        abi: wordRegistryAbi,
        functionName: "marketOfTokenId" as const,
        args: [m.tokenId] as const,
      },
    ]),
    query: { enabled: ADDRESSES_READY && markets.length > 0, refetchInterval: 30_000 },
  });
  const pending = useReadContract({
    address: marketplaceAddress,
    abi: deedMarketplaceAbi,
    functionName: "pendingWithdrawals",
    args: [address],
    query: { enabled: ADDRESSES_READY, refetchInterval: 30_000 },
  });

  const rows = markets
    .map((m, i) => {
      const fees =
        feeReads.data?.[2 * i]?.status === "success"
          ? (feeReads.data[2 * i].result as bigint)
          : 0n;
      const registryMarket =
        feeReads.data?.[2 * i + 1]?.status === "success"
          ? (feeReads.data[2 * i + 1].result as string)
          : null;
      const verified =
        registryMarket !== null && registryMarket.toLowerCase() === m.market.toLowerCase();
      return { ...m, fees, verified };
    })
    .filter((r) => r.fees > 0n && r.verified);
  const proceeds = (pending.data as bigint | undefined) ?? 0n;
  const total = rows.reduce((a, r) => a + r.fees, 0n) + proceeds;

  if (total <= 0n) return null;

  return (
    <Card className="fade-up mb-6 p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">Your earnings — ready to claim</h2>
        <span className="text-xl font-semibold tabular-nums">{ethLabel(total)}</span>
      </div>
      <div className="divide-y divide-border">
        {rows.map((r) => (
          <FeeRow
            key={r.market}
            word={r.word}
            market={r.market}
            fees={r.fees}
            onClaimed={() => void feeReads.refetch()}
          />
        ))}
        {proceeds > 0n && (
          <ProceedsRow amount={proceeds} onDone={() => void pending.refetch()} />
        )}
      </div>
    </Card>
  );
}

/** Accrued trade fees on one word's market — claimFees() pays the deed holder. */
function FeeRow({
  word,
  market,
  fees,
  onClaimed,
}: {
  word: string;
  market: Address;
  fees: bigint;
  onClaimed: () => void;
}) {
  const toast = useToast();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useReceiptError(receipt, "The fee claim");
  useEffect(() => {
    if (receipt.isSuccess) {
      toast.success("Fees claimed");
      onClaimed(); // row disappears once fees read back zero
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);
  const busy = isPending || receipt.isLoading;
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="min-w-0 text-sm">
        <Link to={`/word/${encodeURIComponent(word)}`} className="font-medium hover:underline">
          {word}
        </Link>{" "}
        <span className="text-muted">trade fees</span>
      </span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-medium tabular-nums">{ethLabel(fees)}</span>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() =>
            writeContract(
              {
                address: market,
                abi: wordMarketAbi,
                functionName: "claimFees",
                chainId: activeChain.id,
              },
              {
                onError: (e) => toast.error(friendlyError(e)),
                onSuccess: () => toast.info("Claiming… confirm in your wallet"),
              },
            )
          }
        >
          {busy ? <Spinner /> : "Claim"}
        </Button>
      </span>
    </div>
  );
}

/** Marketplace pull balance — deed-sale proceeds + buy-overpayment refunds. */
function ProceedsRow({ amount, onDone }: { amount: bigint; onDone: () => void }) {
  const toast = useToast();
  const { writeContract, data: hash, isPending } = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash });
  useReceiptError(receipt, "The withdrawal");
  useEffect(() => {
    if (receipt.isSuccess) {
      toast.success("Withdrawn to your wallet");
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);
  const busy = isPending || receipt.isLoading;
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="text-sm text-muted">Deed sales &amp; refunds</span>
      <span className="flex shrink-0 items-center gap-3">
        <span className="text-sm font-medium tabular-nums">{ethLabel(amount)}</span>
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
              {
                onError: (e) => toast.error(friendlyError(e)),
                onSuccess: () => toast.info("Withdrawing… confirm in your wallet"),
              },
            )
          }
        >
          {busy ? <Spinner /> : "Withdraw"}
        </Button>
      </span>
    </div>
  );
}
