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
    query: { enabled: ADDRESSES_READY },
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
