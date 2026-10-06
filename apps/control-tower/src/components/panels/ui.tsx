import type { ReactNode } from "react";
import styles from "./panels.module.css";

export { styles as panel };

export function PanelTitle({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className={styles.titleRow}>
      <div>
        <h2 id="stage-title">{title}</h2>
        {lead && <p className={styles.lead}>{lead}</p>}
      </div>
      {children && <div className={styles.titleAside}>{children}</div>}
    </div>
  );
}

export function Section({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className={styles.section} aria-labelledby={id} data-testid={id}>
      <div className={styles.sectionHead}>
        <h3 id={id}>{title}</h3>
        {aside && <div className={styles.sectionAside}>{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className={styles.kv}>
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NotYet({ children }: { children: ReactNode }) {
  return <p className={styles.notYet}>{children}</p>;
}

/** AI-written text: always marked, with who wrote it and what the auditor said. */
export function AgentText({ author, audit, children }: { author: string; audit?: string | null; children: ReactNode }) {
  return (
    <figure className={styles.agentText} data-testid="agent-text">
      <figcaption>
        Written by {author}
        {audit && <>; {audit === "PASS" ? "every statement checked by the Evidence Integrity Auditor" : audit === "UNVERIFIED" ? "not verified: the auditor was unavailable, a person must check it" : `audit ${audit.toLowerCase()}`}</>}
      </figcaption>
      <div>{children}</div>
    </figure>
  );
}
