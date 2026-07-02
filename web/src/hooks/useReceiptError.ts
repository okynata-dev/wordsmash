import { useEffect } from "react";
import { useToast } from "../components/Toast";
import { friendlyError } from "../lib/format";

/**
 * Surface an on-chain failure AFTER submission. wagmi's receipt query throws on
 * status:"reverted" (and on timeouts), which lands in `isError` — if nobody reads
 * it, the spinner just stops and the user can't tell whether money moved. Every
 * tx flow mounts this on its receipt so a mid-flight revert (repriced listing,
 * slippage, graduation freeze, revoked whitelist) says so out loud.
 */
export function useReceiptError(
  receipt: { isError: boolean; error: Error | null },
  label: string,
) {
  const toast = useToast();
  useEffect(() => {
    if (receipt.isError) {
      toast.error(`${label} didn’t go through — no funds moved (gas only). ${friendlyError(receipt.error)}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isError]);
}
