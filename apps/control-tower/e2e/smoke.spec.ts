import { expect, test } from "@playwright/test";
import { SA, openCase, rewind, seekState, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "sales");
  await rewind(page);
});

test("the inbox lists every tape's case, most urgent first, and says fixture mode", async ({ page }) => {
  await page.reload();
  await expect(page.getByTestId("fixture-banner")).toContainText("nothing reaches Snowflake");
  await expect(page.getByTestId("persona-badge")).toContainText("BBC_DEMO_SALES");
  for (const id of ["CASE-00000023", SA, "CASE-00000011"]) await expect(page.getByTestId(`inbox-row-${id}`)).toBeVisible();
});

test("the cockpit follows the case through its lifecycle stages", async ({ page }) => {
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
  await openCase(page, SA);
  await expect(page.getByTestId("case-state")).toHaveAttribute("data-state", "PENDING_APPROVAL");
  await expect(page.getByTestId("rail-APPROVAL")).toHaveAttribute("data-status", "current");
  await expect(page.getByTestId("panel-APPROVAL")).toBeVisible();
  for (const stage of ["EVENT", "ANALYSIS", "OPTIONS", "DECISION", "EXECUTION", "OUTCOME", "EVIDENCE"]) {
    await page.getByTestId(`rail-${stage}`).click();
    await expect(page.getByTestId(`panel-${stage}`)).toBeVisible();
  }
});

test("the evidence views render the governed numbers", async ({ page }) => {
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
  await openCase(page, SA, "OPTIONS");
  await expect(page.getByTestId("value-chart")).toBeVisible();
  await expect(page.getByTestId("options-table")).toContainText("$45,301");
  await expect(page.getByTestId("eliminated")).toContainText("spec infeasible");
  await page.getByTestId("rail-DECISION").click();
  await expect(page.getByTestId("decider-badge").first()).toHaveAttribute("data-kind", "RULE");
  await expect(page.getByTestId("brief-q1")).toContainText("$25,685");
  await page.getByTestId("rail-ANALYSIS").click();
  await expect(page.getByTestId("temperature-chart-L-A")).toBeVisible();
});
