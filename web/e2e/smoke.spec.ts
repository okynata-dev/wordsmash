import { test, expect } from "@playwright/test";

// Read-only smoke: verifies the seeded data flows chain -> indexer -> API -> UI on every page.
// Run after: make chain && make deploy && make seed && make indexer-dev && make web-dev.
test.describe("read-only pages render seeded data", () => {
  test("home shows the claim input and live counters", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /claim a word/i })).toBeVisible();
    await expect(page.getByText(/words claimed/i)).toBeVisible();
    await expect(page.getByText(/unique owners/i)).toBeVisible();
  });

  test("leaderboard lists the seeded words", async ({ page }) => {
    await page.goto("/top");
    await expect(page.getByRole("heading", { name: /top words/i })).toBeVisible();
    for (const word of ["base", "genesis", "wordsmash"]) {
      await expect(page.getByText(word, { exact: true }).first()).toBeVisible();
    }
  });

  test("marketplace shows the active listing", async ({ page }) => {
    await page.goto("/market");
    await expect(page.getByText("wordsmash").first()).toBeVisible();
    await expect(page.getByRole("button", { name: /buy/i }).first()).toBeVisible();
  });

  test("word page shows owner and ownership history", async ({ page }) => {
    await page.goto("/word/base");
    await expect(page.locator(".word-display")).toHaveText("base");
    await expect(page.getByText(/ownership history/i)).toBeVisible();
    // The sale shows the price; the buyer renders as a UserBadge (username or short address).
    await expect(page.getByText(/0\.05/).first()).toBeVisible();
  });

  test("normalization: BREAD normalizes to the bread word page", async ({ page }) => {
    await page.goto("/word/BREAD");
    // "bread" is unclaimed, but the param must canonicalize to the bread word.
    await expect(page.locator(".word-display")).toHaveText("bread");
  });
});
