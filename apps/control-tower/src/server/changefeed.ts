/**
 * Live updates without polling from the browser: one poller per signed-in Snowflake
 * user reads V_CASE_INBOX while at least one page is listening, and tells listeners
 * which cases' change tokens moved. Pages then refetch the case view. When nobody is
 * listening, nothing polls, so the warehouse can suspend.
 */

import type { PersonaPort } from "@blueberrychain/bbc-api";

export type FeedEvent =
  | { type: "inbox.changed"; case_ids: string[] }
  | { type: "case.changed"; case_id: string; change_token: string }
  | { type: "feed.error"; message: string };

type Listener = (event: FeedEvent) => void;

interface Poller {
  listeners: Set<Listener>;
  tokens: Map<string, string> | null;
  timer: ReturnType<typeof setInterval>;
  lastError: string | null;
}

export class ChangeFeed {
  private readonly pollers = new Map<string, Poller>();

  constructor(private readonly intervalMs: number) {}

  /** Listen for changes visible to `key` (the Snowflake user); returns the unsubscribe function. */
  subscribe(key: string, port: () => PersonaPort, listener: Listener): () => void {
    let poller = this.pollers.get(key);
    if (!poller) {
      const created: Poller = { listeners: new Set(), tokens: null, timer: setInterval(() => void this.poll(key, port), this.intervalMs), lastError: null };
      this.pollers.set(key, created);
      poller = created;
      void this.poll(key, port);
    }
    poller.listeners.add(listener);
    return () => {
      const p = this.pollers.get(key);
      if (!p) return;
      p.listeners.delete(listener);
      if (!p.listeners.size) {
        clearInterval(p.timer);
        this.pollers.delete(key);
      }
    };
  }

  /** Number of users currently polled (for health and tests). */
  activePollers(): number {
    return this.pollers.size;
  }

  async poll(key: string, port: () => PersonaPort): Promise<void> {
    const p = this.pollers.get(key);
    if (!p) return;
    let rows;
    try {
      rows = await port().inbox();
    } catch (error) {
      const message = (error as Error).message;
      if (message !== p.lastError) for (const l of p.listeners) l({ type: "feed.error", message });
      p.lastError = message;
      return;
    }
    p.lastError = null;
    const next = new Map(rows.map((r) => [r.case_id, r.change_token]));
    const prev = p.tokens;
    p.tokens = next;
    if (!prev) return;
    const changed = [...next.keys()].filter((id) => prev.get(id) !== next.get(id));
    const removed = [...prev.keys()].filter((id) => !next.has(id));
    if (!changed.length && !removed.length) return;
    for (const l of p.listeners) {
      l({ type: "inbox.changed", case_ids: [...changed, ...removed] });
      for (const id of changed) l({ type: "case.changed", case_id: id, change_token: next.get(id)! });
    }
  }
}
