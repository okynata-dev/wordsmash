import { useAccount, useReadContract, useChainId } from "wagmi";
import { registryAddress, wordRegistryAbi } from "../contracts";
import { activeChain } from "../wagmi";
import { ADDRESSES_READY } from "../config";

const registry = {
  address: registryAddress,
  abi: wordRegistryAbi,
} as const;

/** Whether the connected wallet is on the right network. */
export function useWrongNetwork(): boolean {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  return isConnected && chainId !== activeChain.id;
}

export function useClaimFee() {
  return useReadContract({
    ...registry,
    functionName: "claimFee",
    // The owner can change the fee on-chain (setClaimFee). A stale cached value
    // makes the claim button show the wrong price AND send too little wei, which
    // reverts with INSUFFICIENT_FEE — so keep this one fresh.
    query: { enabled: ADDRESSES_READY, refetchInterval: 30_000 },
  });
}

export function useMaxClaims() {
  return useReadContract({
    ...registry,
    functionName: "maxClaimsPerAddress",
    query: { enabled: ADDRESSES_READY },
  });
}

export function useRemainingClaims(address?: `0x${string}`) {
  return useReadContract({
    ...registry,
    functionName: "remainingClaims",
    args: address ? [address] : undefined,
    query: { enabled: ADDRESSES_READY && Boolean(address) },
  });
}

export function useWhitelistEnabled() {
  return useReadContract({
    ...registry,
    functionName: "whitelistEnabled",
    query: { enabled: ADDRESSES_READY },
  });
}

export function useIsAllowed(address?: `0x${string}`) {
  return useReadContract({
    ...registry,
    functionName: "isAllowed",
    args: address ? [address] : undefined,
    query: { enabled: ADDRESSES_READY && Boolean(address) },
  });
}

/**
 * Raw whitelist membership for an arbitrary address (e.g. the SELLER of a listing).
 * The contract requires BOTH parties whitelisted for a transfer, so a buyer must
 * check the seller too — otherwise the buy tx reverts.
 */
export function useIsWhitelisted(address?: `0x${string}`) {
  return useReadContract({
    ...registry,
    functionName: "isWhitelisted",
    args: address ? [address] : undefined,
    query: { enabled: ADDRESSES_READY && Boolean(address) },
  });
}
