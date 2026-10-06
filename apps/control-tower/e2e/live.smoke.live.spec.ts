import { expect, test } from "@playwright/test";

test.skip(!process.env["BBC_E2E_LIVE"], "live smoke runs only with BBC_E2E_LIVE=1");

test("signs in as a persona through Snowflake and shows the inbox or which interface is missing", async ({ page }) => {
  const persona = process.env["BBC_E2E_PERSONA"] ?? "sales";
  await page.goto("/sign-in");
  await page.getByTestId(`sign-in-${persona}`).click();
  await page.waitForURL("**/inbox");
  await expect(page.getByTestId("persona-badge")).toContainText("BBC_DEMO_");
  const row = page.locator('[data-testid^="inbox-row-"]').first();
  const missing = page.getByTestId("interface-unavailable");
  await expect(row.or(missing)).toBeVisible();
  await expect(page.getByTestId("fixture-banner")).toHaveCount(0);
});
