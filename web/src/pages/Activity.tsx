import { ActivityFeed, LiveBadge } from "../components/ActivityFeed";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export function Activity() {
  useDocumentTitle("Activity");
  return (
    <div className="mx-auto max-w-[760px]">
      <header className="fade-up mb-6">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          Activity <LiveBadge />
        </h1>
        <p className="mt-1.5 text-sm text-muted">
          Recent claims, listings, deed sales and token trades across wordsmash.
        </p>
      </header>
      <ActivityFeed />
    </div>
  );
}
