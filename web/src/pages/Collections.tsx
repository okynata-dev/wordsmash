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

// Per-collection visual identity: a clean line icon in a gradient tile, plus a
// subtle blue/gray "wash" gradient for the card. All in the brand blue family,
// each nudged to its own hue/corner so the grid reads varied but harmonious.
// Theme-safe: the washes are low-alpha blues that sit fine on light or dark.
type CollStyle = { tile: string; wash: string; Icon: () => JSX.Element };

const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const COLL_STYLES: Record<string, CollStyle> = {
  crypto: {
    tile: "linear-gradient(135deg,#5b8cff,#0000ff)",
    wash: "radial-gradient(120% 120% at 0% 0%, rgba(91,140,255,.16), transparent 58%)",
    Icon: () => (
      <svg {...ICON_PROPS}>
        <path d="M12 2l9 7-9 13L3 9z" />
        <path d="M3 9h18" />
      </svg>
    ),
  },
  vibes: {
    tile: "linear-gradient(135deg,#7ea8ff,#3b6cff)",
    wash: "radial-gradient(120% 120% at 100% 0%, rgba(126,168,255,.17), transparent 58%)",
    Icon: () => (
      <svg {...ICON_PROPS}>
        <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z" />
      </svg>
    ),
  },
  power: {
    tile: "linear-gradient(135deg,#8fa4c8,#1230ff)",
    wash: "radial-gradient(120% 120% at 0% 100%, rgba(120,150,220,.16), transparent 58%)",
    Icon: () => (
      <svg {...ICON_PROPS}>
        <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
      </svg>
    ),
  },
  money: {
    tile: "linear-gradient(135deg,#6fb1cf,#2a52ff)",
    wash: "radial-gradient(120% 120% at 100% 100%, rgba(110,168,205,.16), transparent 58%)",
    Icon: () => (
      <svg {...ICON_PROPS}>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 9v6M18 9v6" />
      </svg>
    ),
  },
  tech: {
    tile: "linear-gradient(135deg,#9aa7bd,#3548c0)",
    wash: "radial-gradient(120% 120% at 50% 0%, rgba(150,165,200,.15), transparent 58%)",
    Icon: () => (
      <svg {...ICON_PROPS}>
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
        <rect x="10" y="10" width="4" height="4" rx="0.5" />
        <path d="M10 2v3M14 2v3M10 19v3M14 19v3M2 10h3M2 14h3M19 10h3M19 14h3" />
      </svg>
    ),
  },
};

const DEFAULT_STYLE: CollStyle = {
  tile: "linear-gradient(135deg,#8aa0c8,#1230ff)",
  wash: "radial-gradient(120% 120% at 0% 0%, rgba(120,150,220,.14), transparent 58%)",
  Icon: () => (
    <svg {...ICON_PROPS}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
};

const styleFor = (key: string): CollStyle => COLL_STYLES[key] ?? DEFAULT_STYLE;

/** The gradient tile that holds a collection's line icon (app-icon style, white glyph). */
function CollectionIcon({ collKey, size = 44 }: { collKey: string; size?: number }) {
  const s = styleFor(collKey);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[11px] text-white"
      style={{
        width: size,
        height: size,
        background: s.tile,
        boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.22), 0 1px 3px rgb(0 0 40 / 0.18)",
      }}
      aria-hidden="true"
    >
      <s.Icon />
    </span>
  );
}

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
              className="card-lift relative overflow-hidden rounded-xl border border-border bg-surface p-5 transition hover:!border-[rgb(var(--c-volt))]"
            >
              {/* subtle per-collection blue/gray wash */}
              <span
                className="pointer-events-none absolute inset-0"
                style={{ background: styleFor(c.key).wash }}
                aria-hidden="true"
              />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <CollectionIcon collKey={c.key} />
                  <span className="text-xs tabular-nums text-faint">
                    {c.claimed}/{c.total} kept
                  </span>
                </div>
                <h2 className="mt-4 font-display text-lg font-semibold">{c.title}</h2>
                <p className="mt-1 text-sm text-muted">{c.blurb}</p>
              </div>
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

      <header className="fade-up mb-6 flex items-center gap-4">
        <CollectionIcon collKey={keyName} size={52} />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {def?.title ?? keyName}
          </h1>
          {def && <p className="mt-1 text-sm text-muted">{def.blurb}</p>}
        </div>
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
