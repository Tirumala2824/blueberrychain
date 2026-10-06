/**
 * The server's long-lived state, created lazily on first request (never at build time)
 * and kept on globalThis so it survives module reloads in development.
 */

import { FixtureWorld } from "@blueberrychain/bbc-api";
import { ChangeFeed } from "./changefeed";
import { loadConfig, type AppConfig } from "./config";
import { FixtureIdentityProvider, PatPersonaProvider, type IdentityProvider } from "./identity";
import { SessionStore } from "./session";

export interface AppContext {
  config: AppConfig;
  store: SessionStore;
  provider: IdentityProvider;
  world: FixtureWorld | null;
  feed: ChangeFeed;
  now: () => number;
}

const KEY = Symbol.for("bbc.control-tower.context");
type Holder = { [KEY]?: AppContext };

export function createAppContext(config: AppConfig = loadConfig(), env: Record<string, string | undefined> = process.env, now: () => number = Date.now): AppContext {
  const world = config.mode === "fixture" ? FixtureWorld.load(config.tapes) : null;
  return {
    config,
    store: new SessionStore(config.sessionSecret, { idleMs: config.sessionIdleMin * 60_000, maxMs: config.sessionMaxH * 3_600_000 }, now),
    provider: world ? new FixtureIdentityProvider(world) : new PatPersonaProvider(env),
    world,
    feed: new ChangeFeed(config.pollMs),
    now,
  };
}

export function appContext(): AppContext {
  const holder = globalThis as Holder;
  holder[KEY] ??= createAppContext();
  return holder[KEY];
}

/** Tests install their own context. */
export function setAppContext(ctx: AppContext | undefined): void {
  const holder = globalThis as Holder;
  if (ctx) holder[KEY] = ctx;
  else delete holder[KEY];
}
