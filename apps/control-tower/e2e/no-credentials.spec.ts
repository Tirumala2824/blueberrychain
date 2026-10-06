import { expect, test } from "@playwright/test";
import { CANARY_PAT } from "../playwright.config";
import { SA, consoleRun, openCase, rewind, seekState, signIn } from "./helpers";

test("the browser never talks to Snowflake and never receives a credential", async ({ page, context }) => {
  const hosts = new Set<string>();
  const leaks: string[] = [];
  page.on("request", (r) => hosts.add(new URL(r.url()).host));
  page.on("response", async (r) => {
    const type = r.headers()["content-type"] ?? "";
    if (!/json|javascript|html|css|text\/plain/.test(type)) return;
    const body = await r.text().catch(() => "");
    if (body.includes(CANARY_PAT)) leaks.push(r.url());
  });

  await signIn(page, "sales");
  await rewind(page);
  await seekState(page, "S-A", SA, "PENDING_APPROVAL");
  await openCase(page, SA);
  for (const stage of ["ANALYSIS", "OPTIONS", "DECISION", "APPROVAL", "EVIDENCE"]) await page.getByTestId(`rail-${stage}`).click();
  await consoleRun(page, "status");
  await consoleRun(page, 'approve reason "spec fits"');
  await expect(page.getByTestId("confirm-card")).toBeVisible();

  expect([...hosts].filter((h) => !h.startsWith("127.0.0.1"))).toEqual([]);
  expect([...hosts].some((h) => h.includes("snowflakecomputing"))).toBe(false);
  expect(leaks).toEqual([]);
  const cookies = await context.cookies();
  expect(cookies.map((c) => c.name)).toEqual(["bbc_sid"]);
  expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict" });
});
