"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ApiError } from "@/client/api";
import { useSession } from "@/client/session";
import styles from "./sign-in.module.css";

/** What each role is for, in general terms; the thresholds live in the active policy (see Policy). */
const DUTIES: Record<string, string> = {
  quality: "Quality and operations: approves recoveries that are hard to undo, and recoveries an AI agent chose.",
  sales: "Customer commitments: approves selling a lot to someone else, and changes to tier-A orders.",
  finance: "Money: approves claims, grower deductions, write-offs and settlements.",
  auditor: "Proof: verifies the ledger, replays evidence as of decision time, exports evidence packs. Never approves.",
  govadmin: "Policy: reads the active policy and can stop all dispatch in an emergency.",
};

function SignIn() {
  const { state, signIn } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  if (!state) return null;

  const go = async (persona: string) => {
    setBusy(persona);
    setError(null);
    try {
      await signIn(persona, code || undefined);
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/inbox");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign-in failed.");
      setBusy(null);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <h1>Sign in to the control tower</h1>
        <p className="muted">
          Choose who you are. You act as that person's own Snowflake user, so Snowflake records every approval under their name and
          enforces their role. The browser never holds a Snowflake credential.
        </p>
        {state.mode === "fixture" && (
          <p className={styles.fixture}>Fixture mode: you are replaying recorded tapes. Nothing you do reaches Snowflake.</p>
        )}
      </div>
      {state.access_code_required && (
        <label className={styles.code}>
          Access code
          <input type="password" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </label>
      )}
      <ul className={styles.people}>
        {state.options.map((o) => (
          <li key={o.persona}>
            <button type="button" className={styles.person} disabled={!o.available || busy !== null} onClick={() => void go(o.persona)} data-testid={`sign-in-${o.persona}`}>
              <span className={styles.title}>{o.title}</span>
              <span className={styles.duty}>{DUTIES[o.persona]}</span>
              <span className={styles.ident}>
                <span className="id">{o.user}</span> as <span className="id">{o.role}</span>
              </span>
              {!o.available && <span className={styles.missing}>No credential configured on this server</span>}
              {busy === o.persona && <span className={styles.busy}>Checking with Snowflake…</span>}
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
