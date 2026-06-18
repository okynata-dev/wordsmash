import { useAccount } from "wagmi";
import { useWatchlist } from "../hooks/useWatchlist";
import { WordTile } from "../components/WordTile";
import { WalletButton } from "../components/WalletButton";
import { Card, ErrorState, Skeleton } from "../components/ui";
import { timeAgo } from "../lib/format";

export function Watchlist() {
  const { address, isConnected } = useAccount();
  const { data, isLoading, isError, refetch } = useWatchlist(address);

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
        <p className="mt-1 text-sm text-muted">Words you’re keeping an eye on.</p>
      </header>

      {!isConnected ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center text-sm text-muted">
          <span>Connect your wallet to see your watchlist.</span>
          <WalletButton />
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState message="Couldn’t load your watchlist." onRetry={() => void refetch()} />
      ) : !data || data.length === 0 ? (
        <Card className="p-6 text-sm text-muted">
          Nothing here yet. Star a word from its page to add it.
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((w) => (
            <WordTile
              key={w.tokenId}
              word={w.word}
              footer={w.claimedAt ? `claimed ${timeAgo(w.claimedAt)}` : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
