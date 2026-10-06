import type { CaseView } from "@blueberrychain/bbc-api";
import { Value } from "@/components/common/Value";
import { humanizeCode } from "@/console/templates";
import { utcSeconds } from "@/domain/format";
import { panel } from "./ui";
import styles from "./MutationCard.module.css";

type Mutation = CaseView["execution"]["mutations"][number];

const STEPS: [string, string][] = [
  ["proposed_at", "Proposed"],
  ["evaluated_at", "Policy evaluated"],
  ["approved_at", "Approved"],
  ["authorized_at", "Authorized"],
  ["dispatched_at", "Sent"],
  ["acked_at", "Acknowledged"],
  ["verified_at", "Verified"],
];
const EXITS = new Set(["ABORTED_PRECONDITION", "CONFLICT", "FAILED", "COMPENSATING", "COMPENSATED", "REJECTED", "EXPIRED", "SHADOW"]);

const TARGET: Record<string, string> = { SAP: "SAP S/4HANA", TMS: "Carrier TMS", CARRIER: "Carrier", CUSTOMER_EDI: "Customer (EDI)", EMAIL: "Email", INTERNAL: "Internal" };

export function MutationCard({ m }: { m: Mutation }) {
  const r = m.record;
  const stamps = (r?.timestamps ?? { proposed_at: m.updated_at }) as Record<string, string | null | undefined>;
  const expBefore = m.intent.expected_before as Record<string, unknown>;
  const expAfter = m.intent.expected_after as Record<string, unknown>;
  const seenBefore = (r?.observed_before ?? {}) as Record<string, unknown>;
  const seenAfter = (r?.observed_after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(expBefore), ...Object.keys(expAfter), ...Object.keys(seenBefore), ...Object.keys(seenAfter)])];
  const tone = m.status === "VERIFIED" ? panel.good : EXITS.has(m.status) ? panel.bad : panel.info;
  return (
    <article className={styles.card} data-testid={`mutation-${m.mutation_id}`} data-status={m.status}>
      <header className={styles.head}>
        <h4>
          {m.step_seq && <span className={`num ${styles.step}`}>{m.step_seq}</span>}
          {humanizeCode(m.action_type)} in {TARGET[m.target_system] ?? m.target_system}
        </h4>
        <span className={`${panel.pill} ${tone}`}>{humanizeCode(m.status).toLowerCase()}</span>
        <span className="faint">
          <span className="id">{m.mutation_id}</span> on {humanizeCode(m.intent.target_entity.type).toLowerCase()} <span className="id">{m.intent.target_entity.id}</span>
          {r?.external_ref && <>, their reference <span className="id">{r.external_ref}</span></>}
        </span>
      </header>
      <ol className={styles.track} aria-label="Gateway steps">
        {STEPS.filter(([k]) => stamps[k]).map(([k, label]) => (
          <li key={k}>
            <span className={styles.trackLabel}>{label}</span>
            <span className="num faint">{utcSeconds(stamps[k])}</span>
          </li>
        ))}
        {EXITS.has(m.status) && (
          <li className={styles.exit}>
            <span className={styles.trackLabel}>{humanizeCode(m.status)}</span>
            {r?.last_error && <span>{r.last_error.message}</span>}
          </li>
        )}
      </ol>
      {keys.length > 0 && (
        <table className={`${panel.table} ${styles.diff}`}>
          <thead>
            <tr>
              <th scope="col">Field at the target</th>
              <th scope="col">Expected before</th>
              <th scope="col">Seen before</th>
              <th scope="col">Expected after</th>
              <th scope="col">Seen after</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const eb = expBefore[k];
              const ob = seenBefore[k];
              const ea = expAfter[k];
              const oa = seenAfter[k];
              const beforeBad = eb !== undefined && ob !== undefined && JSON.stringify(eb) !== JSON.stringify(ob);
              const afterBad = ea !== undefined && oa !== undefined && JSON.stringify(ea) !== JSON.stringify(oa);
              return (
                <tr key={k}>
                  <td>{humanizeCode(k)}</td>
                  <td><Value value={eb} /></td>
                  <td className={beforeBad ? styles.mismatch : undefined}><Value value={ob} /></td>
                  <td><Value value={ea} /></td>
                  <td className={afterBad ? styles.mismatch : undefined}><Value value={oa} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {r && r.metric_snapshot.drift.length > 0 && (
        <table className={`${panel.table} ${styles.diff}`}>
          <thead>
            <tr>
              <th scope="col">Measure since the decision</th>
              <th scope="col" className={panel.r}>At decision</th>
              <th scope="col" className={panel.r}>At execution</th>
              <th scope="col" className={panel.r}>Change</th>
              <th scope="col">Within tolerance</th>
            </tr>
          </thead>
          <tbody>
            {r.metric_snapshot.drift.map((d) => (
              <tr key={d.name}>
                <td>{humanizeCode(d.name)}</td>
                <td className={`${panel.r} num`}>{d.frozen}</td>
                <td className={`${panel.r} num`}>{d.live}</td>
                <td className={`${panel.r} num`}>{d.delta}</td>
                <td><span className={`${panel.pill} ${d.within_tolerance ? panel.good : panel.bad}`}>{d.within_tolerance ? "yes" : "no: re-authorize"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r && (
        <p className={styles.chain}>
          Decided by {r.actor_chain.decider_kind.toLowerCase()} <span className="id">{r.actor_chain.decider_id}</span>
          {r.actor_chain.model && <> ({r.actor_chain.model})</>}
          {r.actor_chain.approvers.length > 0 && <>, approved by {r.actor_chain.approvers.map((a) => `${a.user} as ${a.role}`).join(" and ")}</>}
          , executed by <span className="id">{r.actor_chain.executor_user}</span> as {r.actor_chain.executor_role}, autonomy L{r.autonomy_level}.
          {m.compensation_of && <> Compensates <span className="id">{m.compensation_of}</span>.</>}
          {m.compensated_by && <> Compensated by <span className="id">{m.compensated_by}</span>.</>}
          <span className={panel.hash}> idempotency key {m.intent.idempotency_key.slice(0, 12)}…</span>
        </p>
      )}
    </article>
  );
}
