import type { CaseView } from "@blueberrychain/bbc-api";
import { entryText, laneOf } from "@/console/templates";
import { utcSeconds } from "@/domain/format";
import { panel } from "./ui";
import styles from "./LedgerTable.module.css";

type Entry = CaseView["evidence"]["ledger"]["entries"][number];

const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;
const recordId = (ref: string) => ref.split("#")[1] ?? ref;

/** Ledger entries as recorded: who acted, what, and the hash links of the chain. */
export function LedgerTable({ entries, chain = false }: { entries: Entry[]; chain?: boolean }) {
  return (
    <table className={`${panel.table} ${styles.ledger}`} data-testid="ledger-table">
      <thead>
        <tr>
          <th scope="col" className={panel.r}>Seq</th>
          <th scope="col">Time</th>
          <th scope="col">Who</th>
          <th scope="col">What</th>
          <th scope="col">Record</th>
          {chain && <th scope="col">Chain (previous → this entry)</th>}
        </tr>
      </thead>
      <tbody>
        {entries.map((e, i) => {
          const lane = laneOf(e.entry_type, e.actor);
          const linked = i === 0 || entries[i - 1]!.entry_hash === e.prev_hash;
          return (
            <tr key={e.seq} data-seq={e.seq}>
              <td className={`${panel.r} num`}>{e.seq}</td>
              <td className="num">{utcSeconds(e.ts)}</td>
              <td>
                <span className={`${styles.lane} ${styles[lane]}`}>{lane}</span>
                <div className="faint">{e.actor}</div>
              </td>
              <td>{entryText(e.entry_type)}</td>
              <td className="id">{recordId(e.record_ref)}</td>
              {chain && (
                <td className={panel.hash}>
                  {short(e.prev_hash)} → {short(e.entry_hash)}
                  {!linked && <span className={`${panel.pill} ${panel.bad}`}> chain break</span>}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
