import { describe, expect, it } from "vitest";
import { PatPersonaProvider, SignInError } from "./identity";

const env = { SNOWFLAKE_ACCOUNT: "acct", BBC_SALES_PAT: "pat-sales" };

function whoamiFetch(user: string, role: string) {
  const seen: { headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const impl = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push({ headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({
      data: [[user, role]],
      resultSetMetaData: { rowType: [{ name: "USER_NAME", type: "TEXT" }, { name: "ROLE_NAME", type: "TEXT" }] },
    }), { status: 200 });
  }) as typeof fetch;
  return { impl, seen };
}

describe("PatPersonaProvider (live sign-in)", () => {
  it("offers only personas whose PAT is configured", () => {
    const options = new PatPersonaProvider(env).options();
    expect(options.find((o) => o.persona === "sales")).toMatchObject({ available: true, user: "BBC_DEMO_SALES", role: "BBC_SALES_MGR" });
    expect(options.find((o) => o.persona === "quality")!.available).toBe(false);
  });

  it("signs in as the user Snowflake reports, with the persona's own PAT and role", async () => {
    const f = whoamiFetch("BBC_DEMO_SALES", "BBC_SALES_MGR");
    const identity = await new PatPersonaProvider(env, f.impl).signIn("sales");
    expect(identity).toEqual({ persona: "sales", user: "BBC_DEMO_SALES", role: "BBC_SALES_MGR", provider: "pat" });
    expect(f.seen[0]!.headers.Authorization).toBe("Bearer pat-sales");
    expect(f.seen[0]!.body["role"]).toBe("BBC_SALES_MGR");
  });

  it("refuses a token whose role restriction or user is wrong", async () => {
    await expect(new PatPersonaProvider(env, whoamiFetch("BBC_DEMO_SALES", "BBC_ENGINE").impl).signIn("sales")).rejects.toBeInstanceOf(SignInError);
    await expect(new PatPersonaProvider(env, whoamiFetch("BBC_DEMO_QUALITY", "BBC_SALES_MGR").impl).signIn("sales")).rejects.toThrow(/not BBC_DEMO_SALES/);
    await expect(new PatPersonaProvider(env).signIn("finance")).rejects.toThrow(/BBC_FINANCE_PAT/);
  });
});
