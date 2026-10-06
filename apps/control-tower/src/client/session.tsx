"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiGet, apiSend, setCsrf } from "./api";

export interface PersonaOption {
  persona: string;
  title: string;
  user: string;
  role: string;
  available: boolean;
}

export interface SessionState {
  mode: "live" | "fixture";
  identity: { persona: string; user: string; role: string } | null;
  csrf: string | null;
  options: PersonaOption[];
  access_code_required: boolean;
}

interface SessionApi {
  state: SessionState | null;
  signIn(persona: string, accessCode?: string): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState | null>(null);

  const apply = useCallback((s: SessionState) => {
    setCsrf(s.csrf);
    setState(s);
  }, []);

  const refresh = useCallback(async () => apply(await apiGet<SessionState>("/api/session")), [apply]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const api = useMemo<SessionApi>(
    () => ({
      state,
      refresh,
      signIn: async (persona, accessCode) =>
        apply(await apiSend<SessionState>("POST", "/api/session", { persona, ...(accessCode ? { access_code: accessCode } : {}) })),
      signOut: async () => apply(await apiSend<SessionState>("DELETE", "/api/session")),
    }),
    [state, refresh, apply],
  );
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession outside SessionProvider");
  return ctx;
}
