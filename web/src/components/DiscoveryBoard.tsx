import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type WordSort } from "../api";
import { WordTile } from "./WordTile";
import { Card, ErrorState, Skeleton } from "./ui";
import { timeAgo } from "../lib/format";

interface TabDef {
  key: string;
  label: string;
  sort: WordSort;
}

const TABS: TabDef[] = [
  { key: "new", label: "New", sort: "recent" },
  { key: "trending", label: "Trending", sort: "trading" },
  { key: "graduating", label: "About to graduate", sort: "graduating" },
  { key: "top", label: "Top", sort: "volume" },
];

/**
 * The discovery board: tabbed grid of WordTiles fed by /words with different
 * sorts. Refetches periodically so freshly-claimed / freshly-traded words appear
 * without a reload — the live "what's hot right now" surface.
 */
export function DiscoveryBoard() {
  const [active, setActive] = useState<TabDef>(TABS[0]);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["words", active.sort],
    queryFn: () => api.words(active.sort),
    retry: 1,
    refetchInterval: 15_000,
  });

  const words = (data?.items ?? []).slice(0, 12);

  return (
    <div>
      <div
        role="tablist"
        aria-label="Discover words"
        className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-surface-2 p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={active.key === t.key}
            onClick={() => setActive(t)}
            className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition ${
              active.key === t.key ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-8 w-32" />
              <Skeleton className="mt-4 h-4 w-24" />
            </Card>
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load words." onRetry={() => void refetch()} />
      ) : words.length === 0 ? (
        <Card className="p-6 text-sm text-muted">Nothing here yet.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {words.map((w, i) => (
            <WordTile
              key={w.tokenId}
              index={i}
              word={w.word}
              owner={w.owner}
              tokenPrice={w.priceWei}
              graduationProgressBps={w.graduationProgressBps}
              graduated={w.graduated}
              claimedAt={w.claimedAt}
              footer={w.claimedAt ? `claimed ${timeAgo(w.claimedAt)}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
