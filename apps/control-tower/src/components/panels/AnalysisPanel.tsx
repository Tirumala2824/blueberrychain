"use client";

import { TemperatureChart, type ClaimMark, type Marker } from "@/components/charts/TemperatureChart";
import { Cite } from "@/components/common/bits";
import { useCockpit } from "@/components/cockpit/context";
import { celsius, partyName, pct, utc } from "@/domain/format";
import { humanizeCode } from "@/console/templates";
import { AgentRuns, agentName } from "./AgentRuns";
import { AgentText, KV, NotYet, PanelTitle, Section, panel } from "./ui";

const TRUST: Record<string, string | undefined> = { HIGH: panel.good, MEDIUM: panel.warn, LOW: panel.bad };
const VERDICT: Record<string, string | undefined> = { SUPPORTED: panel.good, REJECTED: panel.bad, INCONCLUSIVE: panel.warn, CONSISTENT: panel.good, CONFLICT: panel.bad, UNVERIFIABLE: "" };

export function AnalysisPanel() {
  const { view, now, openEvidence } = useCockpit();
  const pack = view.analysis.pack;
  const rec = view.decision.recommendations.find((r) => r.status === "ACTIVE");
  const decided = view.governance.approvals.map((a) => a.decided_at).filter((t): t is string => !!t).sort().at(-1);
  const markers: Marker[] = [
    { at: view.case.onset_at, label: "Breach began" },
    { at: view.case.detected_at, label: "Detected" },
    ...(pack ? [{ at: pack.as_of, label: "Evidence as of" }] : []),
    ...(decided ? [{ at: decided, label: "Approved" }] : []),
  ];
  const claimsFor = (lotId: string): ClaimMark[] =>
    (pack?.documents ?? []).flatMap((d) =>
      d.claims
        .filter((c) => typeof c.value === "number" && c.unit === "C" && c.claimed_at && (!pack || pack.lots.some((l) => l.lot_id === lotId)))
        .map((c) => ({
          at: c.claimed_at!,
          value: c.value as number,
          sensor: c.consistency?.sensor_value ?? null,
          verdict: c.consistency?.verdict ?? "UNVERIFIABLE",
          label: humanizeCode(d.doc_type),
        })),
    );
  const contradictions = (pack?.documents ?? []).flatMap((d) => d.claims.map((c) => ({ doc: d, claim: c })));
  const finding = view.analysis.findings.find((f) => f.status === "ACCEPTED") ?? view.analysis.findings.at(-1);
  const brief = rec?.brief;

  return (
    <>
      <PanelTitle title="Analysis" lead="What the sensors, documents and custody records say, and what caused the excursion." />
      {view.analysis.thermal.map((t) => (
        <Section key={t.lot_id} title={`Temperature of ${t.lot_id}, by who held it`} id={`thermal-${t.lot_id}`}>
          <TemperatureChart
            thermal={t}
            custody={pack ? pack.custody_timeline.map((c) => ({ party: c.party_id, type: c.holder_type, from: c.from_at, to: c.to_at ?? null })) : null}
            markers={markers}
            claims={claimsFor(t.lot_id)}
          />
        </Section>
      ))}
      {!pack ? (
        <NotYet>The evidence pack hasn't been sealed yet. It freezes every fact the decision will use.</NotYet>
      ) : (
        <>
          {pack.shipment.reefer_state && (
            <Section title="The reefer, as it reported itself" id="reefer" aside={`As of ${utc(pack.shipment.reefer_state.as_of, now)}`}>
              <KV
                items={[
                  ["Alarms", pack.shipment.reefer_state.alarms.length ? pack.shipment.reefer_state.alarms.map(humanizeCode).join(", ") : "none"],
                  ["Mode", humanizeCode(pack.shipment.reefer_state.mode ?? "unknown")],
                  ["Setpoint", celsius(pack.shipment.reefer_state.setpoint_c)],
                  ["Supply air", celsius(pack.shipment.reefer_state.supply_air_c)],
                  ["Return air", celsius(pack.shipment.reefer_state.return_air_c)],
                  ["Setpoint on the bill of lading", celsius(pack.shipment.bol_setpoint_c)],
                ]}
              />
            </Section>
          )}
          <Section title="Who used up the shelf life" id="custody" aside="Share of excess shelf-life loss, attributed by Snowflake from probe readings">
            <table className={panel.table}>
              <thead>
                <tr>
                  <th scope="col">Lot</th>
                  <th scope="col">Holder</th>
                  <th scope="col" className={panel.r}>Share of excess loss</th>
                  <th scope="col" className={panel.r}>Exposure above threshold</th>
                  <th scope="col" className={panel.r}>Minutes above</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {pack.lots.flatMap((l) =>
                  l.custody_exposure.map((e) => (
                    <tr key={`${l.lot_id}-${e.holder_party_id}`}>
                      <td className="id">{l.lot_id}</td>
                      <td>
                        {partyName(e.holder_party_id)} <span className="faint">{e.holder_type.toLowerCase()}</span>
                      </td>
                      <td className={`${panel.r} num`}>{pct(e.excess_life_share)}</td>
                      <td className={`${panel.r} num`}>{e.thermal_exposure_deg_h.toFixed(1)} °C·h</td>
                      <td className={`${panel.r} num`}>{e.breach_min}</td>
                      <td>{e.evidence_id && <Cite id={e.evidence_id} onOpen={openEvidence} />}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </Section>
          <Section title="Documents against the sensors" id="documents" aside="Each claim a document makes, checked against the probe at the claimed time">
            {contradictions.length ? (
              <table className={panel.table} data-testid="contradictions">
                <thead>
                  <tr>
                    <th scope="col">Document</th>
                    <th scope="col">Claims</th>
                    <th scope="col" className={panel.r}>Document says</th>
                    <th scope="col" className={panel.r}>Probe read</th>
                    <th scope="col" className={panel.r}>Difference</th>
                    <th scope="col">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {contradictions.map(({ doc, claim }) => (
                    <tr key={`${doc.doc_id}-${claim.claim_key}`} className={claim.consistency?.verdict === "CONFLICT" ? panel.emph : undefined}>
                      <td>
                        <span className="id">{doc.doc_id}</span>
                        <div className="faint">{humanizeCode(doc.doc_type)}, received {utc(doc.received_at, now)}</div>
                      </td>
                      <td>
                        {humanizeCode(claim.claim_key)}
                        {claim.claimed_at && <div className="faint">at {utc(claim.claimed_at, now)}</div>}
                      </td>
                      <td className={`${panel.r} num`}>{typeof claim.value === "number" ? `${claim.value} ${claim.unit ?? ""}` : String(claim.value)}</td>
                      <td className={`${panel.r} num`}>{claim.consistency?.sensor_value ?? "–"}</td>
                      <td className={`${panel.r} num`}>{claim.consistency?.delta ?? "–"}</td>
                      <td>
                        <span className={`${panel.pill} ${VERDICT[claim.consistency?.verdict ?? "UNVERIFIABLE"] ?? ""}`}>{(claim.consistency?.verdict ?? "unchecked").toLowerCase()}</span>
                        {claim.evidence_id && <Cite id={claim.evidence_id} onOpen={openEvidence} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <NotYet>No documents have arrived for this case.</NotYet>
            )}
          </Section>
        </>
      )}
      <Section title="Cause" id="finding">
        {!finding ? (
          <NotYet>No cause has been recorded yet.</NotYet>
        ) : finding.unadjudicated || !finding.finding ? (
          <p className={panel.note}>
            No agent was needed: the evidence doesn't conflict, so Snowflake's deterministic custody attribution stands. Claims stay in notice-only
            mode until a cause is adjudicated.
          </p>
        ) : (
          <>
            <KV
              items={[
                ["Most likely cause", humanizeCode(finding.finding.most_likely_cause)],
                ["Confidence", <span key="c" className={`${panel.pill} ${TRUST[finding.confidence ?? ""] ?? ""}`}>{(finding.confidence ?? "unknown").toLowerCase()}</span>],
                ["Evidence", humanizeCode(finding.finding.sufficiency)],
                ["Responsible", finding.finding.responsible_parties.map((p) => `${partyName(p.party_id)} (${humanizeCode(p.basis).toLowerCase()})`).join(", ") || "nobody"],
                ...(brief?.comparison.p_liab_attribution_only !== undefined && brief?.comparison.p_liab_attribution_only !== null
                  ? [["Liability, sensors alone vs with this finding", <span key="p" className="num">{pct(brief.comparison.p_liab_attribution_only)} vs {pct(brief.comparison.p_liab_with_finding)}</span>] as [string, React.ReactNode]]
                  : []),
              ]}
            />
            <table className={panel.table} style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th scope="col">Hypothesis</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {finding.finding.hypotheses.map((h) => (
                  <tr key={h.cause}>
                    <td>{humanizeCode(h.cause)}</td>
                    <td><span className={`${panel.pill} ${VERDICT[h.verdict] ?? ""}`}>{h.verdict.toLowerCase()}</span></td>
                    <td>{h.evidence_ids.map((id) => <Cite key={id} id={id} onOpen={openEvidence} />)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className={panel.table} style={{ marginTop: 16 }}>
              <thead>
                <tr>
                  <th scope="col">Evidence</th>
                  <th scope="col">Trust</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {finding.finding.evidence_trust.map((t) => (
                  <tr key={t.evidence_id}>
                    <td><Cite id={t.evidence_id} onOpen={openEvidence} /></td>
                    <td><span className={`${panel.pill} ${TRUST[t.trust] ?? ""}`}>{t.trust.toLowerCase()}</span></td>
                    <td>{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 16 }}>
              <AgentText author={agentName("EXCURSION_FORENSICS")}>
                <p>{finding.finding.narrative}</p>
              </AgentText>
            </div>
          </>
        )}
      </Section>
      {view.agents.runs.some((r) => r.agent === "EXCURSION_FORENSICS") && (
        <Section title="Forensics run" id="forensics-run">
          <AgentRuns runs={view.agents.runs} caseId={view.case.case_id} onCite={openEvidence} agents={["EXCURSION_FORENSICS"]} />
        </Section>
      )}
    </>
  );
}
