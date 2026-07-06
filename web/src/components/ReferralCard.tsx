// Your referral dashboard (own profile only): a copyable invite link + a summary
// of who you've invited and the on-chain footprint they've generated.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { Card } from "./ui";
import { UserBadge } from "./UserBadge";
import { ethLabel, shortAddr } from "../lib/format";

export function ReferralCard({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const { data } = useQuery({
    queryKey: ["referrals", address.toLowerCase()],
    queryFn: () => api.referrals(address),
    retry: 1,
  });

  const link = `${window.location.origin}/?ref=${address}`;

  async function copy() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  }

  const t = data?.totals;

  return (
    <Card className="fade-up mb-6 p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-muted">Invite &amp; earn</h2>
        {t && t.count > 0 && (
          <span className="text-xs text-faint">
            {t.count} invited · {t.wordsKept} words · {ethLabel(t.volumeWei)} volume
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 p-2 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted">{link}</span>
        <button
          onClick={copy}
          className="shrink-0 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg transition hover:opacity-90"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
      <p className="mt-2 text-xs text-faint">
        Share your link. When someone connects and confirms, they’re credited to you.
        On-chain fee sharing for referrers is planned for mainnet.
      </p>

      {data && data.invited.length > 0 && (
        <div className="mt-4 divide-y divide-border border-t border-border">
          {data.invited.slice(0, 8).map((inv) => (
            <div key={inv.address} className="flex items-center justify-between py-2 text-sm">
              <UserBadge address={inv.address} size={20} />
              <span className="flex items-center gap-3 text-xs text-muted">
                <span>{inv.words} words</span>
                <span className="tabular-nums">{ethLabel(inv.volumeWei)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {data?.referrer && (
        <p className="mt-3 text-xs text-faint">
          You were invited by{" "}
          <span className="font-medium text-muted" title={data.referrer}>
            {shortAddr(data.referrer)}
          </span>
          .
        </p>
      )}
    </Card>
  );
}
