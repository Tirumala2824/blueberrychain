import { expect, test } from "@playwright/test";
import { SA, openCase, rewind, seekState, signIn } from "./helpers";

test("the auditor verifies the chain in Snowflake, catches a tampered clone and replays the pack", async ({ page }) => {
  await signIn(page, "auditor");
  await rewind(page);
  await seekState(page, "S-A", SA, "OUTCOME_RECORDED");
  await openCase(page, SA, "EVIDENCE");

  await page.getByRole("button", { name: "Verify the ledger" }).click();
  await expect(page.getByTestId("verify-result").last()).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("verify-result").last()).toContainText("Chain intact");

  await page.getByRole("button", { name: "Verify the tampered clone" }).click();
  await expect(page.getByTestId("verify-result").last()).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("verify-result").last()).toContainText("broken at seq 416");

  await page.getByRole("button", { name: "Replay the current pack" }).click();
  await expect(page.getByTestId("replay-result").last()).toHaveAttribute("data-equal", "true");

  await page.getByRole("button", { name: "Export the evidence pack" }).click();
  await expect(page.getByTestId("export-result").last()).toContainText("Download");
});

test("other roles read the proof but can't run it", async ({ page }) => {
  await signIn(page, "sales");
  await rewind(page);
  await seekState(page, "S-A", SA, "OUTCOME_RECORDED");
  await openCase(page, SA, "EVIDENCE");
  await expect(page.getByRole("button", { name: "Verify the ledger" })).toHaveCount(0);
  await expect(page.getByTestId("ledger-table")).toContainText("Case opened by the detection task");
});
