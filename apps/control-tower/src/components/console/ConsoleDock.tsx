"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { CaseView } from "@blueberrychain/bbc-api";
import { apiGet, apiSend, ApiError } from "@/client/api";
import type { ConfirmCard as Card, ConsoleEntry } from "@/console/artifacts";
import { complete } from "@/console/complete";
import { ArtifactView } from "./ArtifactView";
import { ConfirmCard } from "./ConfirmCard";
import styles from "./console.module.css";

export interface ConsoleHandle {
  run(input: string): void;
  prefill(input: string): void;
}

const errorEntry = (input: string, message: string): ConsoleEntry => ({
  id: `local-${Date.now()}`,
  at: new Date().toISOString(),
  case_id: null,
  input,
  user: "",
  role: "",
  artifact: { type: "error", message, code: null, suggestions: [] },
});

export const ConsoleDock = forwardRef<ConsoleHandle, { caseId: string | null; view: CaseView | null; onChanged?: () => void }>(function ConsoleDock({ caseId, view, onChanged }, ref) {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(true);
  const [pending, setPending] = useState<Card | null>(null);
  const [sel, setSel] = useState(-1);
  const [recall, setRecall] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useEffect(() => {
    void apiGet<{ entries: ConsoleEntry[] }>(`/api/console/history${caseId ? `?case=${caseId}` : ""}`)
      .then((b) => setEntries(b.entries))
      .catch(() => setEntries([]));
  }, [caseId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [entries.length, pending]);

  const push = (e: ConsoleEntry) => setEntries((prev) => [...prev, e]);

  const run = useCallback(
    async (text: string) => {
      const t = text.trim();
      if (!t || busy) return;
      setOpen(true);
      setBusy(true);
      setInput("");
      setSel(-1);
      setRecall(-1);
      try {
        const { entry } = await apiSend<{ entry: ConsoleEntry }>("POST", "/api/console", { input: t, case_id: caseId });
        push(entry);
        if (entry.artifact.type === "confirm") setPending(entry.artifact.card);
      } catch (e) {
        push(errorEntry(t, e instanceof ApiError ? e.message : "The control tower didn't answer."));
      } finally {
        setBusy(false);
      }
    },
    [busy, caseId],
  );

  const confirm = async (card: Card) => {
    setBusy(true);
    try {
      const { entry } = await apiSend<{ entry: ConsoleEntry }>("POST", "/api/console/confirm", { token: card.token });
      push(entry);
      setPending(null);
      onChangedRef.current?.();
    } catch (e) {
      push(errorEntry("confirm", e instanceof ApiError ? e.message : "The control tower didn't answer."));
    } finally {
      setBusy(false);
    }
  };

  useImperativeHandle(ref, () => ({
    run: (t) => void run(t),
    prefill: (t) => {
      setOpen(true);
      setInput(t);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.setSelectionRange(t.length, t.length);
      });
    },
  }), [run]);

  const completions = useMemo(() => (input ? complete(input, view) : []), [input, view]);
  const inputs = entries.map((e) => e.input).filter((i) => !i.startsWith("confirm"));

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && completions.length) {
      setSel((s) => (s + 1) % completions.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp" && completions.length && sel >= 0) {
      setSel((s) => (s - 1 + completions.length) % completions.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp" && inputs.length) {
      const next = recall < 0 ? inputs.length - 1 : Math.max(0, recall - 1);
      setRecall(next);
      setInput(inputs[next]!);
      e.preventDefault();
    } else if ((e.key === "Tab" || (e.key === "Enter" && sel >= 0)) && completions.length) {
      setInput(completions[Math.max(0, sel)]!.value);
      setSel(-1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      void run(input);
      e.preventDefault();
    } else if (e.key === "Escape") {
      setSel(-1);
      setInput("");
    }
  };

  return (
    <section className={`${styles.dock} ${open ? styles.open : styles.closed}`} aria-label="Console" data-testid="console">
      <header className={styles.head}>
        <h2>Console</h2>
        <span className={styles.hint}>
          Commands act on this case as you. Type <kbd>help</kbd>, or <kbd>?</kbd> and a question for Cortex Analyst.
        </span>
        <button type="button" className={styles.toggle} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Collapse" : "Expand"}
        </button>
      </header>
      {open && entries.length > 0 && (
        <div className={styles.transcript} aria-live="polite">
          {entries.map((e) => (
            <div key={e.id} className={styles.entry} data-artifact={e.artifact.type}>
              <div className={styles.input}>
                <span className={styles.prompt} aria-hidden="true">›</span> <span>{e.input}</span>
              </div>
              {e.artifact.type === "confirm" ? (
                <p className={styles.confirmNote}>{pending?.token === e.artifact.card.token ? "Waiting for your confirmation below." : "Confirmation closed."}</p>
              ) : (
                <ArtifactView artifact={e.artifact} onRun={(t) => void run(t)} />
              )}
            </div>
          ))}
          <div ref={endRef} />
        </div>
      )}
      {pending && <ConfirmCard card={pending} busy={busy} onConfirm={() => void confirm(pending)} onCancel={() => setPending(null)} />}
      <div className={styles.line}>
        <span className={styles.prompt} aria-hidden="true">›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setSel(-1);
          }}
          onKeyDown={onKey}
          placeholder={busy ? "Waiting for Snowflake…" : "status, brief, why OPT-…, approve, verify, ? which lots are below 8 days"}
          aria-label="Console command"
          aria-autocomplete="list"
          aria-controls="console-completions"
          aria-expanded={completions.length > 0}
          role="combobox"
          spellCheck={false}
          autoComplete="off"
          disabled={busy}
          data-testid="console-input"
        />
        {completions.length > 0 && (
          <ul id="console-completions" className={styles.completions} role="listbox">
            {completions.map((c, i) => (
              <li
                key={c.value}
                role="option"
                aria-selected={i === sel}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setInput(c.value);
                  inputRef.current?.focus();
                }}
              >
                <span className="id">{c.label}</span>
                <span className={styles.compHint}>{c.hint}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
});
