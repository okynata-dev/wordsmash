import { ActivityFeed } from "../components/ActivityFeed";

export function Activity() {
  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Live activity</h1>
        <p className="mt-1 text-sm text-muted">Recent claims, listings and sales across wordsmash.</p>
      </header>
      <ActivityFeed />
    </div>
  );
}
