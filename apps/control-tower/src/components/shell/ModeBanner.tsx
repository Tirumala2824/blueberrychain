"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiSend } from "@/client/api";
import { FIXTURE_MOVED } from "@/client/live";
import styles from "./ModeBanner.module.css";

interface TapePosition {
  tape: string;
  title: string;
  provenance: string;
  frame: number;
  frames: number;
  label: string;
}

/**
 * Fixture mode is never mistakable for the real system: a persistent strip says that
 * nothing reaches Snowflake, which tape and frame is showing, and lets the presenter step.
 */
export function ModeBanner() {
  const [tapes, setTapes] = useState<TapePosition[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setTapes((await apiGet<{ tapes: TapePosition[] }>("/api/fixture")).tapes);
    } catch {
      setTapes([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [load]);

  const move = async (body: Record<string, unknown>) => {
    setTapes((await apiSend<{ tapes: TapePosition[] }>("POST", "/api/fixture", body)).tapes);
    window.dispatchEvent(new Event(FIXTURE_MOVED));
  };

  return (
    <div className={styles.banner} role="status" data-testid="fixture-banner">
      <div className={styles.row}>
        <strong>Fixture mode.</strong>
        <span>Recorded tapes, not decisions: nothing reaches Snowflake, and every answer is a recording.</span>
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Hide tape controls" : "Tape controls"}
        </button>
      </div>
      {open && (
        <ul className={styles.tapes}>
          {tapes.map((t) => (
            <li key={t.tape}>
              <span className={styles.tapeName}>{t.title}</span>
              <span className="num" data-testid={`tape-${t.tape}-frame`}>
                Frame {t.frame + 1} of {t.frames}
              </span>
              <span className={styles.label}>{t.label}</span>
              <span className={styles.buttons}>
                <button type="button" onClick={() => void move({ op: "step", tape: t.tape, delta: -1 })} disabled={t.frame === 0}>
                  Previous
                </button>
                <button type="button" onClick={() => void move({ op: "step", tape: t.tape, delta: 1 })} disabled={t.frame === t.frames - 1}>
                  Next
                </button>
              </span>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => void move({ op: "reset" })}>
              Rewind every tape
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
