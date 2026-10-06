/**
 * Server-side sessions. The browser holds only `bbc_sid`: a random id signed with
 * HMAC-SHA256 (HttpOnly, SameSite=Strict). The session holds who signed in, the CSRF
 * token, pending confirmation grants and the console history: ephemeral UI state,
 * never persisted and never treated as decision memory.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { BoundCall } from "@blueberrychain/bbc-api";
import type { ConsoleEntry } from "../console/artifacts";
import type { Identity } from "./identity";

export const COOKIE = "bbc_sid";
const HISTORY_LIMIT = 200;

/** A short-lived, single-use permission to run one exact governed call. */
export interface ConfirmGrant {
  token: string;
  caseId: string | null;
  call: BoundCall;
  briefHash: string | null;
  changeToken: string | null;
  input: string;
  expiresAt: number;
  used: boolean;
}

export interface Session {
  id: string;
  identity: Identity;
  csrf: string;
  createdAt: number;
  lastSeen: number;
  history: Map<string, ConsoleEntry[]>;
  grants: Map<string, ConfirmGrant>;
}

export interface SessionLimits {
  idleMs: number;
  maxMs: number;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly secret: Buffer,
    private readonly limits: SessionLimits,
    private readonly now: () => number = Date.now,
  ) {}

  create(identity: Identity): { session: Session; cookie: string } {
    const id = randomBytes(32).toString("base64url");
    const t = this.now();
    const session: Session = {
      id, identity, csrf: randomBytes(24).toString("base64url"), createdAt: t, lastSeen: t,
      history: new Map(), grants: new Map(),
    };
    this.sessions.set(id, session);
    return { session, cookie: `${id}.${this.sign(id)}` };
  }

  /** The session for a cookie value, or null if unsigned, tampered, unknown or expired. */
  fromCookie(value: string | undefined | null): Session | null {
    if (!value) return null;
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const id = value.slice(0, dot);
    const sig = Buffer.from(value.slice(dot + 1));
    const expected = Buffer.from(this.sign(id));
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
    const session = this.sessions.get(id);
    if (!session) return null;
    const t = this.now();
    if (t - session.lastSeen > this.limits.idleMs || t - session.createdAt > this.limits.maxMs) {
      this.sessions.delete(id);
      return null;
    }
    session.lastSeen = t;
    return session;
  }

  destroy(id: string): void {
    this.sessions.delete(id);
  }

  addHistory(session: Session, caseKey: string, entry: ConsoleEntry): void {
    const list = session.history.get(caseKey) ?? [];
    list.push(entry);
    if (list.length > HISTORY_LIMIT) list.splice(0, list.length - HISTORY_LIMIT);
    session.history.set(caseKey, list);
  }

  private sign(id: string): string {
    return createHmac("sha256", this.secret).update(id).digest("base64url");
  }
}

export function cookieHeader(value: string, maxAgeS: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeS}`;
}

export function clearCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

export function readCookie(header: string | null, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
