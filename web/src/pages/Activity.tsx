import { useState } from "react";
import { ActivityFeed, LiveBadge } from "../components/ActivityFeed";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

// Filter presets map a chip to the raw activity types it should show.
const FILTERS = [
  { key: "all", label: "All", types: undefined as string[] | undefined },
  { key: "claims", label: "Claims", types: ["claim"] },
  { key: "trades", label: "Trades", types: ["buy", "sell"] },
  { key: "deeds", label: "Deed sales", types: ["list", "cancel", "sale", "transfer"] },
] as const;

export function Activity() {
  useDocumentTitle("Activity");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const active = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];

  return (
    <div className="mx-auto max-w-[760px]">
      <header className="fade-up mb-5">
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight sm:text-3xl">
          Activity <LiveBadge />
        </h1>
      </header>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist" aria-label="Filter activity">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            role="tab"
            aria-selected={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              filter === f.key
                ? "bg-surface-2 font-medium text-fg"
                : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* The header says LIVE — poll at the fast (~4s) cadence to match. */}
      <ActivityFeed live types={active.types} />
    </div>
  );
}
