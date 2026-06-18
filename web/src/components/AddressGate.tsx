import { Card } from "./ui";
import { WORD_REGISTRY, DEED_MARKETPLACE, USE_ANVIL } from "../config";

/** Shown when contract addresses aren't configured. */
export function AddressGate() {
  return (
    <div className="mx-auto max-w-xl py-12">
      <Card className="space-y-4 p-6">
        <h1 className="text-xl font-semibold">Set contract addresses</h1>
        <p className="text-sm text-muted">
          The app needs the deployed contract addresses to run. Create a{" "}
          <code className="rounded bg-surface-2 px-1">web/.env</code> (or{" "}
          <code className="rounded bg-surface-2 px-1">.env.local</code>) and set:
        </p>
        <pre className="overflow-x-auto rounded-lg bg-surface-2 p-4 text-xs">
{`VITE_WORD_REGISTRY=0x...
VITE_DEED_MARKETPLACE=0x...
VITE_API_URL=http://localhost:8787
${USE_ANVIL ? "VITE_USE_ANVIL=1" : "# VITE_USE_ANVIL=1   # for local anvil"}`}
        </pre>
        <ul className="space-y-1 text-xs text-muted">
          <li>
            WordRegistry:{" "}
            <span className={WORD_REGISTRY ? "text-positive" : "text-negative"}>
              {WORD_REGISTRY ?? "not set"}
            </span>
          </li>
          <li>
            DeedMarketplace:{" "}
            <span className={DEED_MARKETPLACE ? "text-positive" : "text-negative"}>
              {DEED_MARKETPLACE ?? "not set"}
            </span>
          </li>
        </ul>
        <p className="text-xs text-faint">Restart the dev server after editing env vars.</p>
      </Card>
    </div>
  );
}
