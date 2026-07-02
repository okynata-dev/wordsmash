import { test, expect } from "@playwright/test";
import { injectWallet, ACCOUNTS } from "./inject-wallet";

// Full on-chain flow: claim -> profile -> list -> buy from another account -> leaderboard.
//
// Requires a FRESH deploy (no seed, or claim limit not yet hit by acc0):
//   make chain && make deploy && make indexer-dev && make web-dev
// The injected provider forwards to anvil (unlocked accounts), so writes are auto-signed.
//
// Uses a unique word per run so re-runs against the same chain don't collide.
const WORD = `e2e${Date.now().toString(36)}`;
const API = process.env.API_URL ?? "http://localhost:8787";

test("claim a word, list it, and buy it from a second account", async ({ page, request }) => {
  // Miniflare doesn't auto-run the cron, so we trigger indexing after each on-chain write
  // (in production the */1 cron does this). Helper reflects new state into the read API.
  const ADMIN = process.env.ADMIN_TOKEN ?? "TODO_OPERATOR_ADMIN_TOKEN"; // local default
  const reindex = async () => {
    await request.post(`${API}/admin/index`, { headers: { Authorization: `Bearer ${ADMIN}` } });
  };
  // Enroll via the whitelist gate if it is shown (one verifyWhitelist tx, auto-signed by anvil).
  const enrollIfNeeded = async () => {
    // A word page can show MORE than one whitelist gate (deed area + token market), so target the
    // first. One enroll tx whitelists the wallet globally, opening every gate.
    const enroll = page.getByRole("button", { name: /enroll|verify whitelist/i }).first();
    // The gate reads isAllowed() from chain async — wait for it to settle before deciding.
    await enroll.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    if (await enroll.isVisible().catch(() => false)) {
      await enroll.click();
      await expect(enroll).toBeHidden({ timeout: 20_000 });
    }
  };

  // --- Account 0 connects, enrolls (whitelist), claims a fresh word ---
  await injectWallet(page, ACCOUNTS.acc2);
  await page.goto("/");
  // Sign-in: header button opens the wallet dialog; pick the injected wallet.
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.getByRole("button", { name: /browser wallet/i }).click();
  // Connected state is an account pill — a profile LINK, not a button.
  await expect(page.getByRole("link", { name: /0x3c44/i })).toBeVisible({ timeout: 15_000 });

  await page.getByPlaceholder(/type a word|bread/i).fill(WORD);
  await expect(page.getByText(/is available/i)).toBeVisible();
  await enrollIfNeeded(); // gate renders once a valid word is entered
  await page.getByRole("button", { name: /^keep it/i }).click();
  await page.waitForTimeout(2000);
  await reindex();

  // It should appear on the owner's profile.
  await page.goto(`/profile/${ACCOUNTS.acc2}`);
  await expect(page.getByText(WORD).first()).toBeVisible({ timeout: 20_000 });

  // --- List it for sale on the word page (approve, then list — two txs) ---
  await page.goto(`/word/${WORD}`);
  await page.getByPlaceholder(/price/i).fill("0.02");
  // Approve the marketplace once (hidden if this wallet already granted approval-for-all).
  const approve = page.getByRole("button", { name: /^approve$/i });
  if (await approve.isVisible().catch(() => false)) {
    await approve.click();
    await page.waitForTimeout(2000);
  }
  await page.getByRole("button", { name: /^list$/i }).click();
  await page.waitForTimeout(2000);
  await reindex();
  await page.reload(); // refetch word detail now that the Listed event is indexed
  await expect(page.getByRole("button", { name: /cancel/i })).toBeVisible({ timeout: 20_000 });

  // --- Account 1 buys it (re-inject as acc1; wagmi auto-reconnects to the new provider) ---
  await injectWallet(page, ACCOUNTS.acc3);
  await page.goto(`/word/${WORD}`);
  // Sign-in: header button opens the wallet dialog; pick the injected wallet.
  const connect = page.getByRole("button", { name: /sign in/i }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click();
    await page.getByRole("button", { name: /browser wallet/i }).click();
  }
  // Connected state is an account pill — a profile LINK, not a button.
  await expect(page.getByRole("link", { name: /0x90f7/i })).toBeVisible({ timeout: 15_000 });
  await enrollIfNeeded();
  // The DEED buy button is labelled "Buy · <price> ETH"; the token-market buy is just "Buy".
  await page.getByRole("button", { name: /buy.*eth/i }).first().click();
  await page.waitForTimeout(2000);
  await reindex();

  // Ownership now reflects account 1.
  await page.reload();
  await expect(page.getByText(/0x90f7/i).first()).toBeVisible({ timeout: 20_000 });

  // And it shows up in the leaderboard / marketplace volume.
  await page.goto("/top");
  await expect(page.getByText(WORD).first()).toBeVisible();
});
