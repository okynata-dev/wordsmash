import { useAccount } from "wagmi";
import { useWatchlist } from "../hooks/useWatchlist";
import { WordTile } from "../components/WordTile";
import { WalletButton } from "../components/WalletButton";
import { LiveBadge } from "../components/ActivityFeed";
import { Card, ErrorState, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Watchlist() {
  useDocumentTitle("Watchlist");
  const { address, isConnected } = useAccount();
  const { data, isLoading, isError, refetch } = useWatchlist(address);
  const count = data?.length ?? 0;

  return (
    <div className="mx-auto max-w-[960px]">
      <header className="fade-up mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          Watchlist
          {isConnected && count > 0 && <LiveBadge />}
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          {isConnected && count > 0
            ? `${count} ${count === 1 ? "word" : "words"} you’re tracking. Updates live as they trade.`
            : "Words you’re keeping an eye on. Star a word from its page to add it."}
        </p>
      </header>

      {!isConnected ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted">
          <span>Connect your wallet to see your watchlist.</span>
          <WalletButton />
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load your watchlist." onRetry={() => void refetch()} />
      ) : count === 0 ? (
        <Card className="p-6 text-sm text-muted">
          Nothing here yet. Star a word from its page to add it.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {data!.map((w, i) => (
            <WordTile
              key={w.tokenId}
              index={i}
              word={w.word}
              footer={w.claimedAt ? `claimed ${timeAgo(w.claimedAt)}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
