// Collections — curated, themed groups of words for discovery. The index shows
// every collection with a live "claimed / total" count; opening one lists its
// claimed words (market-enriched) as tiles.
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { collectionByKey } from "@shared/collections";
import { WordTile } from "../components/WordTile";
import { Card, ErrorState, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Collections() {
  const { key } = useParams();
  return key ? <CollectionDetail keyName={key} /> : <CollectionsIndex />;
}

function CollectionsIndex() {
  useDocumentTitle("Collections");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["collections"],
    queryFn: api.collections,
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-[960px]">
      <header className="fade-up mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Collections</h1>
        <p className="mt-1 text-sm text-muted">Curated groups of words to explore.</p>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      ) : isError || !data ? (
        <ErrorState message="Couldn’t load collections." onRetry={() => void refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.map((c) => (
            <Link
              key={c.key}
              to={`/collections/${c.key}`}
              className="card-lift rounded-xl border border-border bg-surface p-5 transition hover:!border-[rgb(var(--c-volt))]"
            >
              <div className="flex items-center justify-between">
                <span className="text-2xl">{c.emoji}</span>
                <span className="text-xs tabular-nums text-faint">
                  {c.claimed}/{c.total} kept
                </span>
              </div>
              <h2 className="mt-3 font-display text-lg font-semibold">{c.title}</h2>
              <p className="mt-1 text-sm text-muted">{c.blurb}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionDetail({ keyName }: { keyName: string }) {
  const def = collectionByKey(keyName);
  useDocumentTitle(def ? `${def.title} · Collections` : "Collection");
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["collection", keyName],
    queryFn: () => api.collection(keyName),
    retry: 1,
  });
  const words = data ?? [];

  return (
    <div className="mx-auto max-w-[960px]">
      <Link to="/collections" className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-fg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Collections
      </Link>

      <header className="fade-up mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          {def?.emoji} {def?.title ?? keyName}
        </h1>
        {def && <p className="mt-1 text-sm text-muted">{def.blurb}</p>}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load this collection." onRetry={() => void refetch()} />
      ) : words.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          None of these words are kept yet — be the first.
        </Card>
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
