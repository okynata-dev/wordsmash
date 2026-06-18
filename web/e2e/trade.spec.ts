import { test, expect } from "@playwright/test";
import { injectWallet, ACCOUNTS } from "./inject-wallet";

// Validates the v2 bonding-curve BUY flow end to end through the real UI:
// connect -> coin page -> enter ETH -> quote -> buy (with slippage) -> on-chain -> indexed.
// acc0 is whitelisted/enrolled by `make seed` and owns "genesis".
const API = process.env.API_URL ?? "http://localhost:8787";
const ADMIN = process.env.ADMIN_TOKEN ?? "TODO_OPERATOR_ADMIN_TOKEN";

test("buy tokens on a word's bonding-curve market via the UI", async ({ page, request }) => {
  const tradesOf = async () => {
    const r = await request.get(`${API}/word/genesis/trades`);
    const j = (await r.json()) as { items: unknown[] };
    return j.items.length;
  };
  const before = await tradesOf();

  await injectWallet(page, ACCOUNTS.acc0);
  await page.goto("/word/genesis");
  const connect = page.getByRole("button", { name: /connect wallet/i }).first();
  if (await connect.isVisible().catch(() => false)) await connect.click();
  await expect(page.getByRole("button", { name: /0xf39f/i })).toBeVisible({ timeout: 15_000 });

  // acc0 is already enrolled; if the gate shows, enroll.
  const enroll = page.getByRole("button", { name: /enroll|verify whitelist/i });
  await enroll.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  if (await enroll.isVisible().catch(() => false)) {
    await enroll.click();
    await expect(enroll).toBeHidden({ timeout: 20_000 });
  }

  // The Buy tab is default. Enter an ETH amount; the quote preview should appear.
  const amount = page.getByPlaceholder("0.0").first();
  await expect(amount).toBeVisible({ timeout: 10_000 });
  await amount.fill("0.3");
  await page.getByRole("button", { name: /^buy$/i }).click();

  // Poll the indexer (cron is manual under wrangler dev) until the new trade lands.
  await expect
    .poll(
      async () => {
        await request.post(`${API}/admin/index`, { headers: { Authorization: `Bearer ${ADMIN}` } });
        return tradesOf();
      },
      { timeout: 25_000, intervals: [1500, 1500, 1500, 2000] },
    )
    .toBeGreaterThan(before);
});
