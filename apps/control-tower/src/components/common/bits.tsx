import { COCKPIT_STAGES, cockpitStageOf, type CaseState } from "@blueberrychain/shared/cockpit";
import { countdown, roleName, urgency, utc } from "@/domain/format";
import { STAGE_NAMES } from "@/console/templates";
import styles from "./bits.module.css";

/** Where a case sits on the 8-stage lifecycle, as a compact strip. */
export function StageStrip({ state }: { state: string }) {
  const current = COCKPIT_STAGES.indexOf(cockpitStageOf(state as CaseState));
  return (
    <span className={styles.strip} role="img" aria-label={`Stage ${current + 1} of 8: ${STAGE_NAMES[COCKPIT_STAGES[current]!]}`}>
      {COCKPIT_STAGES.map((s, i) => (
        <span key={s} className={i < current ? styles.done : i === current ? styles.here : styles.todo} />
      ))}
    </span>
  );
}

export function RoleChip({ role, mine = false }: { role: string; mine?: boolean }) {
  return <span className={mine ? `${styles.role} ${styles.roleMine}` : styles.role}>{roleName(role)}</span>;
}

/** Time left to a deadline, on the case's clock. */
export function Countdown({ deadline, now, label, size = "m" }: { deadline: string | null; now: number; label?: string; size?: "m" | "l" }) {
  const u = urgency(deadline, now);
  return (
    <span className={`${styles.countdown} ${styles[u]} ${size === "l" ? styles.large : ""}`} data-urgency={u}>
      {label && <span className={styles.cdLabel}>{label}</span>}
      <span className={`num ${styles.cdValue}`}>{countdown(deadline, now)}</span>
      {deadline && <span className={styles.cdAt}>at {utc(deadline, now)}</span>}
    </span>
  );
}

const DECIDER: Record<string, string> = { RULE: "Rule", AGENT: "AI agent", HUMAN: "Person", FALLBACK: "Fallback" };

/** Who decided: a rule (no AI), an AI agent (audited), a person, or the fallback. */
export function DeciderBadge({ kind, id, audit }: { kind: string; id?: string | null; audit?: string | null }) {
  return (
    <span className={`${styles.decider} ${styles[`decider${kind}`] ?? ""}`} data-testid="decider-badge" data-kind={kind}>
      <span className={styles.deciderKind}>{DECIDER[kind] ?? kind}</span>
      {id && <span className="id">{id}</span>}
      {kind === "AGENT" && audit && <span className={styles.audit} data-audit={audit}>{audit === "PASS" ? "audit passed" : audit === "UNVERIFIED" ? "unverified" : `audit ${audit.toLowerCase()}`}</span>}
    </span>
  );
}

/** A citation chip; clicking shows the cited fact in the evidence drawer. */
export function Cite({ id, onOpen }: { id: string; onOpen?: (id: string) => void }) {
  const short = id.replace(/^EV:/, "").replace(/#.*$/, (m) => (m.length > 18 ? `${m.slice(0, 16)}…` : m));
  return (
    <button type="button" className={styles.cite} onClick={() => onOpen?.(id)} title={id} data-evidence-id={id}>
      {short}
    </button>
  );
}
