"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CaseView, InboxRow } from "@blueberrychain/bbc-api";
import { ApiError, apiGet } from "./api";

export const FIXTURE_MOVED = "bbc:fixture-moved";

/** Subscribe to this server's change stream; `onChange` runs when Snowflake's change tokens move. */
function useChangeStream(caseId: string | null, onChange: () => void): string | null {
  const [feedError, setFeedError] = useState<string | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const es = new EventSource(caseId ? `/api/stream?case=${caseId}` : "/api/stream");
    const changed = () => cb.current();
    es.addEventListener(caseId ? "case.changed" : "inbox.changed", changed);
    es.addEventListener("feed.error", (e) => setFeedError(JSON.parse((e as MessageEvent).data).message as string));
    es.addEventListener("ready", () => setFeedError(null));
    window.addEventListener(FIXTURE_MOVED, changed);
    return () => {
      es.close();
      window.removeEventListener(FIXTURE_MOVED, changed);
    };
  }, [caseId]);
  return feedError;
}

export interface Loaded<T> {
  data: T | null;
  error: ApiError | null;
  fetchedAt: number;
  feedError: string | null;
  refresh(): Promise<void>;
}

export function useCaseView(caseId: string): Loaded<CaseView> {
  const [data, setData] = useState<CaseView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const body = await apiGet<{ view: CaseView }>(`/api/cases/${caseId}`);
      setData(body.view);
      setError(null);
      setFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "network", (e as Error).message));
    }
  }, [caseId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const feedError = useChangeStream(caseId, () => void refresh());
  return { data, error, fetchedAt, feedError, refresh };
}

export function useInbox(): Loaded<InboxRow[]> {
  const [data, setData] = useState<InboxRow[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const body = await apiGet<{ rows: InboxRow[] }>("/api/inbox");
      setData(body.rows);
      setError(null);
      setFetchedAt(Date.now());
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, "network", (e as Error).message));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const feedError = useChangeStream(null, () => void refresh());
  return { data, error, fetchedAt, feedError, refresh };
}

/**
 * "Now" on the case's clock: the snapshot's time plus the time since it was fetched.
 * Live, that is the wall clock; on a fixture tape it is the tape's moment.
 */
export function useViewClock(generatedAt: string | null | undefined, fetchedAt: number): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!generatedAt || !fetchedAt) return tick;
  return Date.parse(generatedAt) + Math.max(0, tick - fetchedAt);
}
