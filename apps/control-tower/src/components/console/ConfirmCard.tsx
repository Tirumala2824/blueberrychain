"use client";

import { useEffect, useState } from "react";
import type { ConfirmCard as Card } from "@/console/artifacts";
import { duration, roleName } from "@/domain/format";
import styles from "./console.module.css";

/**
 * The only way anything is written: this card shows exactly who will act in Snowflake,
 * on which Brief, and the exact statement with its values. Nothing is sent until Confirm.
 */
export function ConfirmCard({ card, busy, onConfirm, onCancel }: { card: Card; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const [left, setLeft] = useState(() => Date.parse(card.expires_at) - Date.now());
  useEffect(() => {
    const t = setInterval(() => setLeft(Date.parse(card.expires_at) - Date.now()), 1000);
    return () => clearInterval(t);
  }, [card.expires_at]);
  const expired = left <= 0;
  return (
    <div className={styles.confirm} role="dialog" aria-modal="false" aria-labelledby="confirm-title" data-testid="confirm-card">
      <div className={styles.confirmMain}>
        <h3 id="confirm-title">{card.summary}</h3>
        <p className={styles.as}>
          Snowflake will record this as <strong className="id">{card.user}</strong> using role <strong className="id">{card.role}</strong> ({roleName(card.role)}).
          It checks your role, that you didn't propose it, that the Brief hasn't changed and the deadline, and may still refuse.
        </p>
        {card.fixture && <p className={styles.fixtureWarn}>Fixture mode: this replays a recording. Nothing reaches Snowflake.</p>}
        {card.warnings.length > 0 && (
          <ul className={styles.warnings}>
            {card.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        )}
        <div className={styles.confirmActions}>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm} disabled={busy || expired} data-testid="confirm-button">
            {busy ? "Sending…" : "Confirm and send to Snowflake"}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <span className={`num ${styles.expiry}`}>{expired ? "Expired: run the command again" : `Valid for ${duration(left)}`}</span>
        </div>
      </div>
      <div className={styles.confirmCall}>
        <dl className={styles.facts}>
          {card.case_id && (
            <div>
              <dt>Case</dt>
              <dd className="id">{card.case_id}</dd>
            </div>
          )}
          {card.brief_hash && (
            <div>
              <dt>Decision Brief</dt>
              <dd className={styles.hash} data-testid="confirm-brief-hash">{card.brief_hash}</dd>
            </div>
          )}
        </dl>
        <pre className={styles.call} data-testid="confirm-statement">{card.statement}</pre>
        <table className={styles.binds}>
          <tbody>
            {card.binds.map((b, i) => (
              <tr key={b.name}>
                <td className="num">{i + 1}</td>
                <td>{b.name}</td>
                <td className={styles.bindValue}>{b.value === null ? <span className="faint">NULL</span> : String(b.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
