import { expect, test } from "@playwright/test";
import { SA, SB, consoleRun, openCase, rewind, seekState, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page, "quality");
  await rewind(page);
});

test("commands answer from the governed case view, with suggestions instead of guesses", async ({ page }) => {
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
  await openCase(page, SA);
  await page.getByTestId("console-input").fill("ap");
  await expect(page.locator("#console-completions")).toContainText("approve");
  await consoleRun(page, "status");
  await expect(page.getByTestId("artifact-status")).toContainText("Waiting for approval");
  await consoleRun(page, "why 105");
  await expect(page.getByTestId("artifact-option").last()).toContainText("can't meet the customer's specification");
  await consoleRun(page, "aprove");
  await expect(page.getByTestId("artifact-error").last()).toContainText("isn't a command");
  await expect(page.getByTestId("artifact-error").last().getByRole("button", { name: "approve" })).toBeVisible();
});

test("Analyst answers are shown with their SQL and kept apart from decision evidence", async ({ page }) => {
  await openCase(page, SA);
  await consoleRun(page, "? which lots have less than 10 days of shelf life left");
  const answer = page.getByTestId("artifact-analyst");
  await expect(answer).toContainText("not decision evidence");
  await expect(answer).toContainText("SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY");
  await expect(answer).toContainText("L-B");
});

test("a running agent's trace streams live, labelled unrecorded", async ({ page }) => {
  await seekState(page, "S-B", SB, "FORENSICS_PENDING");
  await openCase(page, SB, "ANALYSIS");
  const live = page.getByTestId("live-trace-RUN-00000210");
  await expect(live).toContainText("unrecorded");
  await expect(live).toContainText("GET_CASE_CONTEXT", { timeout: 15_000 });
});

test("AI-written text shows the auditor's verdict on every sentence", async ({ page }) => {
  await seekState(page, "S-B", SB, "PENDING_APPROVAL");
  await openCase(page, SB, "DECISION");
  await expect(page.getByTestId("decider-badge").first()).toHaveAttribute("data-kind", "AGENT");
  await expect(page.getByTestId("audit-spans").locator("mark")).toHaveCount(3);
  await expect(page.getByTestId("audit-spans").locator('mark[data-verdict="SUPPORTED"]')).toHaveCount(3);
});
