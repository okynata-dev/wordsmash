import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useAccount } from "wagmi";
import { useProfile } from "../hooks/useProfile";
import { WordTile } from "../components/WordTile";
import { EarningsCard } from "../components/EarningsCard";
import { Positions } from "../components/Positions";
import { ReferralCard } from "../components/ReferralCard";
import { ShareButton } from "../components/ShareButton";
import { Avatar } from "../components/Avatar";
import { EditProfile } from "../components/EditProfile";
import { Button, Card, Pill, ErrorState, Skeleton } from "../components/ui";
import { ethLabel, shortAddr, timeAgo, normAddr } from "../lib/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import type { ActivityRow } from "@shared/types";

const activityVerb: Record<ActivityRow["type"], string> = {
  claim: "claimed",
  list: "listed",
  cancel: "cancelled listing of",
  sale: "sold",
  transfer: "transferred",
  buy: "bought",
  sell: "sold tokens of",
};

type Tab = "owned" | "positions" | "listings" | "activity";

export function Profile() {
  const { address = "" } = useParams();
  const { address: connected } = useAccount();
  const isSelf = Boolean(connected) && normAddr(connected) === normAddr(address);

  const { data, isLoading, isError, refetch } = useProfile(address);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<Tab>("owned");

  // Returning from the Connect X redirect: a stashed edit draft means the user was
  // mid-edit — reopen the editor so the linked handle + restored fields get saved.
  useEffect(() => {
    if (!isSelf) return;
    try {
      if (sessionStorage.getItem(`keepney.profileDraft.${address.toLowerCase()}`)) {
        setEditing(true);
      }
    } catch {
      /* ignore */
    }
  }, [isSelf, address]);

  const meta = data?.meta;
  const displayName = meta?.username ? `@${meta.username}` : shortAddr(address);
  useDocumentTitle(displayName);

  return (
    <div className="mx-auto max-w-[960px]">
      {isLoading ? (
        <ProfileSkeleton />
      ) : isError ? (
        <ErrorState message="Couldn’t load this profile." onRetry={() => void refetch()} />
      ) : data && meta ? (
        <>
          {editing && isSelf ? (
            <div className="mb-8">
              <EditProfile address={address} meta={meta} onClose={() => setEditing(false)} />
            </div>
          ) : (
            <Card className="fade-up mb-6 flex flex-col gap-4 p-6 sm:flex-row sm:items-start sm:justify-between sm:p-7">
              <div className="flex min-w-0 items-start gap-4">
                <Avatar address={address} size={72} />
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold tracking-tight">{displayName}</h1>
                  <p className="mt-0.5 font-mono text-xs text-faint" title={address}>
                    {shortAddr(address)}
                  </p>
                  {meta.bio && (
                    <p className="mt-2 max-w-prose whitespace-pre-wrap break-words text-sm text-fg/90">
                      {meta.bio}
                    </p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                    {meta.twitterHandle && (
                      <a
                        href={`https://x.com/${meta.twitterHandle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-muted hover:text-fg"
                      >
                        x.com/{meta.twitterHandle}
                        {meta.twitterVerified && (
                          <span className="text-positive" title="Verified" aria-label="Verified">
                            ✓
                          </span>
                        )}
                      </a>
                    )}
                    {meta.website && (
                      <a
                        href={meta.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="truncate text-muted hover:text-fg"
                      >
                        {meta.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                    <span>
                      <span className="font-semibold tabular-nums">{data.stats.owned}</span>{" "}
                      <span className="text-muted">owned</span>
                    </span>
                    <span>
                      <span className="font-semibold tabular-nums">{ethLabel(data.stats.volumeWei)}</span>{" "}
                      <span className="text-muted">deed volume</span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isSelf && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    Edit profile
                  </Button>
                )}
                {data.owned.length > 0 && (
                  <ShareButton word={data.owned[0].word} label="Share" variant="ghost" />
                )}
              </div>
            </Card>
          )}

          {isSelf && connected && (
            <>
              <EarningsCard address={connected} owned={data.owned} />
              <ReferralCard address={connected} />
            </>
          )}

          <div className="mb-4 flex items-center gap-1 border-b border-border text-sm">
            <TabButton active={tab === "owned"} onClick={() => setTab("owned")}>
              Owned <span className="text-faint">· {data.owned.length}</span>
            </TabButton>
            <TabButton active={tab === "positions"} onClick={() => setTab("positions")}>
              Positions
            </TabButton>
            <TabButton active={tab === "listings"} onClick={() => setTab("listings")}>
              Listings <span className="text-faint">· {data.listings.length}</span>
            </TabButton>
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
              Activity
            </TabButton>
          </div>

          {tab === "owned" &&
            (data.owned.length === 0 ? (
              <Empty>No words yet.</Empty>
            ) : (
              <Grid>
                {data.owned.map((w, i) => (
                  <WordTile
                    key={w.tokenId}
                    index={i}
                    word={w.word}
                    footer={`claimed ${timeAgo(w.claimedAt)}`}
                  />
                ))}
              </Grid>
            ))}

          {tab === "positions" && <Positions address={address} />}

          {tab === "listings" &&
            (data.listings.length === 0 ? (
              <Empty>No active listings.</Empty>
            ) : (
              <Grid>
                {data.listings.map((l, i) => (
                  <WordTile key={l.tokenId} index={i} word={l.word} price={l.price} />
                ))}
              </Grid>
            ))}

          {tab === "activity" &&
            (data.activity.length === 0 ? (
              <Empty>No activity yet.</Empty>
            ) : (
              <Card className="divide-y divide-border">
                {data.activity.map((a, i) => (
                  <div key={`${a.tx}-${i}`} className="flex items-center justify-between px-4 py-3 text-sm">
                    <span className="flex items-center gap-2">
                      <Pill>{a.type}</Pill>
                      <span className="text-muted">
                        {activityVerb[a.type]} <span className="font-medium text-fg">{a.word}</span>
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      {a.price ? <span className="font-medium">{ethLabel(a.price)}</span> : null}
                      <span className="text-xs text-faint">{timeAgo(a.ts)}</span>
                    </span>
                  </div>
                ))}
              </Card>
            ))}
        </>
      ) : null}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={[
        "-mb-px border-b-2 px-3 py-2 transition",
        active ? "border-fg font-medium text-fg" : "border-transparent text-muted hover:text-fg",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ProfileSkeleton() {
  return (
    <div>
      <div className="mb-8 flex items-start gap-4">
        <Skeleton className="h-[72px] w-[72px] rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>
      <Grid>
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </Grid>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <Card className="p-5 text-sm text-muted">{children}</Card>;
}
