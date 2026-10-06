import { expect, test } from "@playwright/test";
import { SA, consoleRun, openCase, rewind, seekState, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "sales");
  await rewind(page);
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
});

test("a person without the required role sees Snowflake's reason and no decision buttons", async ({ page }) => {
  await signIn(page, "finance");
  await openCase(page, SA, "APPROVAL");
  await expect(page.getByTestId("cannot-APR-00000060")).toContainText("This approval requires BBC_SALES_MGR");
  await expect(page.getByTestId("approve-button")).toHaveCount(0);
  await consoleRun(page, "approve APR-00000060");
  await expect(page.getByTestId("artifact-error").last()).toContainText("This approval requires BBC_SALES_MGR");
  await expect(page.getByTestId("confirm-card")).toHaveCount(0);
});

test("the auditor can't approve at all", async ({ page }) => {
  await signIn(page, "auditor");
  await openCase(page, SA, "APPROVAL");
  await expect(page.getByTestId("cannot-APR-00000060")).toContainText("never decides them");
});

test("a decision reviewed before the case changed is refused, and must be reviewed again", async ({ browser }) => {
  const salesCtx = await browser.newContext();
  const qualityCtx = await browser.newContext();
  const sales = await salesCtx.newPage();
  const quality = await qualityCtx.newPage();
  await signIn(sales, "sales");
  await signIn(quality, "quality");

  await openCase(sales, SA, "APPROVAL");
  await sales.getByTestId("decision-reason").fill("spec fits");
  await sales.getByTestId("approve-button").click();
  await expect(sales.getByTestId("confirm-card")).toBeVisible();

  await openCase(quality, SA, "APPROVAL");
  await quality.getByTestId("decision-reason").fill("QC agrees");
  await quality.getByTestId("approve-button").click();
  await quality.getByTestId("confirm-button").click();
  await expect(quality.getByTestId("artifact-receipt")).toBeVisible();

  await sales.getByTestId("confirm-button").click();
  await expect(sales.getByTestId("artifact-error").last()).toHaveAttribute("data-code", "CHANGED_SINCE_REVIEW");
  await salesCtx.close();
  await qualityCtx.close();
});
