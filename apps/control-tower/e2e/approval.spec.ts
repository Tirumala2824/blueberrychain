import { expect, test } from "@playwright/test";
import { SA, openCase, rewind, seekState, signIn } from "./helpers";

test("Sales then Quality approve the S-A re-route through confirm cards, and the gateway executes", async ({ page }) => {
  await signIn(page, "sales");
  await rewind(page);
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
  await openCase(page, SA, "APPROVAL");

  await page.getByTestId("approve-button").click();
  const card = page.getByTestId("confirm-card");
  await expect(card).toContainText("BBC_DEMO_SALES");
  await expect(card).toContainText("BBC_SALES_MGR");
  await expect(page.getByTestId("confirm-statement")).toHaveText("CALL BBC_OS.API.DECIDE_APPROVAL(?, ?, ?, ?)");
  await expect(card).toContainText("APR-00000060");
  await expect(page.getByTestId("confirm-brief-hash")).toHaveText(/^[0-9a-f]{64}$/);
  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("artifact-receipt")).toContainText("APR-00000060 as approved by BBC_DEMO_SALES");
  await expect(page.locator('[data-approval-id="APR-00000060"] [data-status]')).toHaveAttribute("data-status", "APPROVED");
  await expect(page.locator('[data-approval-id="APR-00000061"] [data-status]')).toHaveAttribute("data-status", "REQUESTED");

  await signIn(page, "quality");
  await openCase(page, SA, "APPROVAL");
  await page.getByTestId("approve-button").click();
  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("artifact-receipt")).toContainText("APR-00000061 as approved by BBC_DEMO_QUALITY");
  await expect(page.getByTestId("case-state")).toHaveAttribute("data-state", "EXECUTING");
  await page.getByTestId("rail-EXECUTION").click();
  await expect(page.getByTestId("mutation-MUT-00000300")).toHaveAttribute("data-status", "VERIFIED");
  await expect(page.getByTestId("mutation-MUT-00000301")).toHaveAttribute("data-status", "DISPATCHED");
});
