import { test, expect } from "@playwright/test";
import { injectWallet, ACCOUNTS } from "./inject-wallet";

// Validates the SIWE-lite signed-write path end-to-end through the real UI: connect a wallet,
// post a comment (signs commentMessage via the injected provider -> anvil personal_sign), and
// confirm the indexer accepted it and it renders. acc0 is whitelisted/enrolled by `make seed`.
test("post a comment via a signed message and see it appear", async ({ page }) => {
  const body = `gm from e2e ${Date.now().toString(36)}`;

  await injectWallet(page, ACCOUNTS.acc0);
  await page.goto("/word/genesis");
  // Sign-in: header button opens the wallet dialog; pick the injected wallet.
  const connect = page.getByRole("button", { name: /sign in/i }).first();
  if (await connect.isVisible().catch(() => false)) {
    await connect.click();
    await page.getByRole("button", { name: /browser wallet/i }).click();
  }
  // Connected state is an account pill — a profile LINK, not a button.
  await expect(page.getByRole("link", { name: /0xf39f/i })).toBeVisible({ timeout: 15_000 });

  // The comment composer is gated on connected + whitelisted; enroll if the gate appears.
  const enroll = page.getByRole("button", { name: /enroll|verify whitelist/i });
  await enroll.waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  if (await enroll.isVisible().catch(() => false)) {
    await enroll.click();
    await expect(enroll).toBeHidden({ timeout: 20_000 });
  }

  const composer = page.getByPlaceholder(/say something/i);
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill(body);
  await page.getByRole("button", { name: /^post$/i }).click();

  // The new comment should render in the thread after the signed POST + refetch.
  await expect(page.getByText(body)).toBeVisible({ timeout: 20_000 });
});
