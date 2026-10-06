import { expect, type Page } from "@playwright/test";

export const SA = "CASE-00000017";
export const SB = "CASE-00000023";

export async function signIn(page: Page, persona: string): Promise<void> {
  await page.goto("/sign-in");
  await page.getByTestId(`sign-in-${persona}`).click();
  await page.waitForURL("**/inbox");
}

async function fixture(page: Page, body: Record<string, unknown>): Promise<void> {
  const status = await page.evaluate(async (b) => {
    const csrf = ((await (await fetch("/api/session")).json()) as { csrf: string }).csrf;
    const res = await fetch("/api/fixture", { method: "POST", headers: { "content-type": "application/json", "x-bbc-csrf": csrf }, body: JSON.stringify(b) });
    return res.status;
  }, body);
  expect(status).toBe(200);
}

export const rewind = (page: Page) => fixture(page, { op: "reset" });

/** Move a tape to the first frame where the case is in `state`. */
export async function seekState(page: Page, tape: string, caseId: string, state: string): Promise<void> {
  const frame = await page.evaluate(async ({ caseId, state }) => {
    const csrf = ((await (await fetch("/api/session")).json()) as { csrf: string }).csrf;
    for (let f = 0; f < 20; f++) {
      const seek = await fetch("/api/fixture", { method: "POST", headers: { "content-type": "application/json", "x-bbc-csrf": csrf }, body: JSON.stringify({ op: "seek", tape: caseId === "CASE-00000017" ? "S-A" : caseId === "CASE-00000023" ? "S-B" : "S-C", frame: f }) });
      if (!seek.ok) break;
      const view = (await (await fetch(`/api/cases/${caseId}`)).json()) as { view?: { case: { state: string } } };
      if (view.view?.case.state === state) return f;
    }
    return -1;
  }, { caseId, state });
  expect(frame, `${tape} has a frame where ${caseId} is ${state}`).toBeGreaterThanOrEqual(0);
}

export async function openCase(page: Page, caseId: string, stage?: string): Promise<void> {
  await page.goto(`/cases/${caseId}`);
  await expect(page.getByTestId("case-id")).toHaveText(caseId);
  if (stage) await page.getByTestId(`rail-${stage}`).click();
}

export async function consoleRun(page: Page, input: string): Promise<void> {
  const box = page.getByTestId("console-input");
  await box.fill(input);
  await box.press("Escape");
  await box.fill(input);
  await page.keyboard.press("Enter");
}
