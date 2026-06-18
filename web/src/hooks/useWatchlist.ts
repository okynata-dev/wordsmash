import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { watchlistMessage } from "@shared/social";
import { api } from "../api";
import { normAddr } from "../lib/format";

export function watchlistKey(address: string) {
  return ["watchlist", normAddr(address)] as const;
}

/** Fetch the connected user's watchlist (the set of tokenIds they watch). */
export function useWatchlist(address: string | undefined) {
  return useQuery({
    queryKey: watchlistKey(address ?? ""),
    queryFn: () => api.watchlist(address as string),
    enabled: Boolean(address),
    retry: 1,
  });
}

/**
 * Returns a toggle function that signs watchlistMessage and POSTs the change,
 * then invalidates the watchlist query. The caller owns optimistic UI.
 */
export function useToggleWatch() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const qc = useQueryClient();

  return useCallback(
    async (tokenId: string, on: boolean) => {
      if (!address) throw new Error("Connect your wallet to use the watchlist.");
      const timestamp = Date.now();
      const message = watchlistMessage(address, tokenId, on, timestamp);
      const signature = await signMessageAsync({ message });
      const res = await api.toggleWatch(address, { tokenId, on, timestamp, signature });
      await qc.invalidateQueries({ queryKey: watchlistKey(address) });
      return res;
    },
    [address, signMessageAsync, qc],
  );
}
