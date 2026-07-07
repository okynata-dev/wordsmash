import { useCallback, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * Masks indexer lag after an on-chain write. Invalidates the given query keys and
 * then refetches them a few times on an interval so the UI reflects the new state
 * once the indexer catches up. Exposes a `syncing` flag for a "syncing…" hint.
 */
export function useSyncAfterTx() {
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  const sync = useCallback(
    async (keys: QueryKey[], opts?: { attempts?: number; intervalMs?: number }) => {
      const attempts = opts?.attempts ?? 4;
      const intervalMs = opts?.intervalMs ?? 1500;
      setSyncing(true);
      try {
        // Immediate invalidation.
        await Promise.all(keys.map((key) => qc.invalidateQueries({ queryKey: key })));
        // A few delayed refetches to ride out indexer lag.
        for (let i = 0; i < attempts; i++) {
          await new Promise((r) => setTimeout(r, intervalMs));
          await Promise.all(keys.map((key) => qc.refetchQueries({ queryKey: key })));
        }
      } finally {
        // Always clear the flag — a rejected invalidate/refetch must never leave the
        // trade/claim buttons spinner-locked after an otherwise-successful tx.
        setSyncing(false);
      }
    },
    [qc],
  );

  return { sync, syncing };
}
