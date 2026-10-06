/**
 * Server configuration, read lazily from the environment (never at build time).
 * Nothing here is ever sent to the browser: there are no NEXT_PUBLIC_ variables.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

export type ApiMode = "live" | "fixture";

export interface AppConfig {
  mode: ApiMode;
  /** Fixture tapes to load (contracts/tapes/<name>.json), in order. */
  tapes: string[];
  sessionSecret: Buffer;
  /** Optional shared code required at sign-in (compared in constant time). */
  accessCode: string | null;
  /** Inbox / case change polling interval while someone is watching, ms. */
  pollMs: number;
  /** The engine's loopback trace relay (live agent traces), if running. */
  relayUrl: string | null;
  relayToken: string | null;
  /** Origins allowed to POST (CSRF defense in depth, besides the token). */
  allowedOrigins: string[];
  sessionIdleMin: number;
  sessionMaxH: number;
}

/** Contract schemas are read from disk; point at the repo copy when the bundler moved this module. */
function ensureContractsDir(env: Record<string, string | undefined>): void {
  if (env["BBC_CONTRACTS_DIR"]) return;
  for (const candidate of [resolve(process.cwd(), "../../contracts"), resolve(process.cwd(), "contracts")]) {
    if (existsSync(join(candidate, "schemas", "common.json"))) {
      process.env["BBC_CONTRACTS_DIR"] = candidate;
      return;
    }
  }
}

export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  ensureContractsDir(env);
  const mode = (env["BBC_API_MODE"] ?? "live").toLowerCase();
  if (mode !== "live" && mode !== "fixture") throw new Error(`BBC_API_MODE must be live or fixture, not ${mode}`);
  const port = env["PORT"] ?? "3000";
  const origins = (env["BBC_CT_ALLOWED_ORIGINS"] ?? `http://127.0.0.1:${port},http://localhost:${port}`)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const secret = env["BBC_CT_SESSION_SECRET"];
  return {
    mode,
    tapes: (env["BBC_FIXTURE_TAPES"] ?? "S-A,S-B,S-C").split(",").map((t) => t.trim()).filter(Boolean),
    sessionSecret: secret ? Buffer.from(secret, "utf-8") : randomBytes(32),
    accessCode: env["BBC_CT_ACCESS_CODE"] || null,
    pollMs: Number(env["BBC_CT_POLL_MS"] ?? (mode === "fixture" ? 1000 : 4000)),
    relayUrl: env["BBC_ENGINE_RELAY_URL"] || null,
    relayToken: env["BBC_ENGINE_RELAY_TOKEN"] || null,
    allowedOrigins: origins,
    sessionIdleMin: Number(env["BBC_CT_SESSION_IDLE_MIN"] ?? 60),
    sessionMaxH: Number(env["BBC_CT_SESSION_MAX_H"] ?? 8),
  };
}
