"use client";

import { useCockpit } from "@/components/cockpit/context";
import { celsius, partyName, utc } from "@/domain/format";
import { LedgerTable } from "./LedgerTable";
import { KV, PanelTitle, Section, panel } from "./ui";

interface DetectionPayload {
  rule?: { detection_window_min?: number; tolerance_min?: number; threshold_c?: number; policy_version?: string };
  run_id?: string;
}

export function EventPanel() {
  const { view, now } = useCockpit();
  const c = view.case;
  const d = view.event.detection as DetectionPayload;
  return (
    <>
      <PanelTitle
        title="Event"
        lead="The excursion as Snowflake's detection task saw it. Nobody asked: the case opened itself when breach minutes accumulated."
      />
      <Section title="Detection" id="detection">
        <KV
          items={[
            ["Breach began", <span className="num" key="o">{utc(c.onset_at, now)}</span>],
            ["Detected", <span className="num" key="d">{utc(c.detected_at, now)}</span>],
            ["Case opened", <span className="num" key="c">{utc(c.opened_at, now)} by {c.opened_by}</span>],
            ["Holding the lot", `${partyName(c.holder_party_id_at_onset)} (${(c.holder_type_at_onset ?? "unknown").toLowerCase()})`],
            ["Severity", c.severity.toLowerCase()],
            ["Rule", d.rule ? `${d.rule.tolerance_min} breach minutes above ${celsius(d.rule.threshold_c)} within ${d.rule.detection_window_min} minutes (policy v${d.rule.policy_version})` : "–"],
          ]}
        />
      </Section>
      <Section title="Lots in this case" id="lots">
        <table className={panel.table}>
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col">Breach began</th>
              <th scope="col">Detected</th>
              <th scope="col" className={panel.r}>Breach minutes at detection</th>
              <th scope="col" className={panel.r}>Warmest pulp</th>
              <th scope="col">Holder then</th>
            </tr>
          </thead>
          <tbody>
            {c.lots.map((l) => (
              <tr key={l.lot_id}>
                <td className="id">{l.lot_id}</td>
                <td className="num">{utc(l.onset_at, now)}</td>
                <td className="num">{utc(l.detected_at, now)}</td>
                <td className={`${panel.r} num`}>{l.breach_min_at_detection}</td>
                <td className={`${panel.r} num`}>{celsius(l.max_pulp_c)}</td>
                <td>{partyName(l.holder_party_id_at_onset)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
      <Section title="What happened since" id="timeline" aside="Every step is a hash-chained ledger entry, newest last">
        <LedgerTable entries={view.evidence.ledger.entries} />
      </Section>
    </>
  );
}
