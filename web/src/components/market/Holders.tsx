// Top holders of a word's token. The indexer only NOMINATES addresses (from curve
// trades — plain ERC-20 transfers aren't indexed); the numbers shown are LIVE
// on-chain balanceOf reads, so what renders is always the truth.
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useReadContracts } from "wagmi";
import type { Address } from "viem";
import { api } from "../../api";
import { wordMarketAbi } from "../../contracts";
import { ADDRESSES_READY } from "../../config";
import { Card } from "../ui";
import { UserBadge } from "../UserBadge";
import { tokenLabel, normAddr } from "../../lib/format";

const SUPPLY = 10n ** 27n; // 1e9 tokens, fixed per market

export function Holders({
  word,
  market,
  deedOwner,
}: {
  word: string;
  market: Address;
  deedOwner: string | null;
}) {
  const candidates = useQuery({
    queryKey: ["holders", word],
    queryFn: () => api.holders(word),
    retry: 1,
    refetchInterval: 30_000,
  });
  const list = candidates.data ?? [];

  // Live truth: balanceOf for every candidate + the curve's own reserve.
  const reads = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: market, abi: wordMarketAbi, functionName: "balanceOf" as const, args: [market] as const },
      ...list.map((h) => ({
        address: market,
        abi: wordMarketAbi,
        functionName: "balanceOf" as const,
        args: [h.address as Address] as const,
      })),
    ],
    query: { enabled: ADDRESSES_READY && list.length > 0, refetchInterval: 30_000 },
  });

  const rows = useMemo(() => {
    const val = (i: number): bigint =>
      reads.data?.[i]?.status === "success" ? (reads.data[i].result as bigint) : 0n;
    const curve = val(0);
    const holders = list
      .map((h, i) => ({ address: h.address, balance: val(i + 1) }))
      .filter((h) => h.balance > 0n)
      .sort((a, b) => (a.balance > b.balance ? -1 : a.balance < b.balance ? 1 : 0));
    return { curve, holders };
  }, [reads.data, list]);

  if (list.length === 0 || rows.holders.length === 0) return null;

  const pct = (v: bigint) => `${(Number((v * 10_000n) / SUPPLY) / 100).toFixed(2)}%`;

  return (
    <Card className="p-4">
      <h3 className="mb-2 text-sm font-medium text-muted">Holders</h3>
      <div className="flex items-center justify-between py-2 text-[13px]">
        <span className="text-muted">Bonding curve</span>
        <span className="font-medium tabular-nums">{pct(rows.curve)}</span>
      </div>
      {rows.holders.map((h) => (
        <div
          key={h.address}
          className="flex items-center justify-between border-t border-border py-2 text-[13px]"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <UserBadge address={h.address} size={18} textClassName="text-[13px]" />
            {deedOwner && normAddr(h.address) === normAddr(deedOwner) && (
              <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] text-muted" title="Holds the word's deed">
                deed
              </span>
            )}
          </span>
          <span className="shrink-0 text-right">
            <span className="font-medium tabular-nums">{pct(h.balance)}</span>{" "}
            <span className="text-xs text-faint tabular-nums">{tokenLabel(h.balance, null)}</span>
          </span>
        </div>
      ))}
    </Card>
  );
}
