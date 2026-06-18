// Live on-chain reads for a word's bonding-curve token market (v2).
//
// The indexer (WordDetail.market) gives us a fast first paint and the volume /
// market-cap aggregates; these hooks layer *fresh* contract reads on top for the
// numbers that move every block (spot price, the connected wallet's balance,
// graduated flag, accrued deed fees). Everything is guarded so the page renders
// fine when there's no market yet, no wallet, or the addresses aren't configured.

import { useReadContract, useReadContracts } from "wagmi";
import type { Address } from "viem";
import { wordMarketAbi } from "../contracts";
import { ADDRESSES_READY } from "../config";

/** Normalize a possibly-missing market address to a typed Address or undefined. */
export function asMarketAddress(market?: string | null): Address | undefined {
  if (!market) return undefined;
  return /^0x[a-fA-F0-9]{40}$/.test(market) ? (market as Address) : undefined;
}

/**
 * Batch the slow-moving-ish market reads in one multicall: spot price, graduated,
 * deed owner, symbol, accrued deed fees, and aggregate volume / market cap. Pulled
 * fresh so the header stays honest even if the indexer lags a trade.
 */
export function useMarketReads(market?: string | null) {
  const address = asMarketAddress(market);
  const base = { address, abi: wordMarketAbi } as const;

  const query = useReadContracts({
    allowFailure: true,
    contracts: address
      ? [
          { ...base, functionName: "currentPrice" },
          { ...base, functionName: "graduated" },
          { ...base, functionName: "deedOwner" },
          { ...base, functionName: "symbol" },
          { ...base, functionName: "deedFeesAccrued" },
          { ...base, functionName: "totalEthVolume" },
          { ...base, functionName: "marketCapWei" },
        ]
      : [],
    query: { enabled: ADDRESSES_READY && Boolean(address) },
  });

  const r = query.data;
  const val = <T,>(i: number): T | undefined =>
    r && r[i]?.status === "success" ? (r[i].result as T) : undefined;

  return {
    ...query,
    priceWei: val<bigint>(0),
    graduated: val<boolean>(1),
    deedOwner: (val<string>(2) ?? null) as string | null,
    symbol: val<string>(3),
    deedFeesWei: val<bigint>(4),
    volumeWei: val<bigint>(5),
    marketCapWei: val<bigint>(6),
  };
}

/** The connected wallet's token balance on this market (0n when no wallet/market). */
export function useTokenBalance(market?: string | null, account?: Address) {
  const address = asMarketAddress(market);
  return useReadContract({
    address,
    abi: wordMarketAbi,
    functionName: "balanceOf",
    args: account ? [account] : undefined,
    query: { enabled: ADDRESSES_READY && Boolean(address) && Boolean(account) },
  });
}

/**
 * Live quote for a buy (ETH in -> tokens out). `enabled` lets callers pause the
 * read while the user is mid-typing an invalid amount.
 */
export function useQuoteBuy(market: string | null | undefined, ethWei: bigint | null) {
  const address = asMarketAddress(market);
  return useReadContract({
    address,
    abi: wordMarketAbi,
    functionName: "quoteBuy",
    args: ethWei !== null ? [ethWei] : undefined,
    query: {
      enabled: ADDRESSES_READY && Boolean(address) && ethWei !== null && ethWei > 0n,
    },
  });
}

/** Live quote for a sell (tokens in -> ETH out). */
export function useQuoteSell(market: string | null | undefined, tokenAmount: bigint | null) {
  const address = asMarketAddress(market);
  return useReadContract({
    address,
    abi: wordMarketAbi,
    functionName: "quoteSell",
    args: tokenAmount !== null ? [tokenAmount] : undefined,
    query: {
      enabled: ADDRESSES_READY && Boolean(address) && tokenAmount !== null && tokenAmount > 0n,
    },
  });
}
