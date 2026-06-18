import { defineConfig, devices } from "@playwright/test";

// E2E expects the full local stack already running:
//   make chain   (anvil)         -> :8545
//   make deploy                  -> writes shared/deployments/anvil.json
//   make indexer-dev             -> :8787
//   make web-dev  (VITE_USE_ANVIL=1, addresses set) -> :5173
// The wallet is injected (see e2e/inject-wallet.ts) and forwards to anvil, whose dev
// accounts are unlocked, so eth_sendTransaction is auto-signed — no MetaMask needed.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  use: {
    baseURL: process.env.WEB_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
