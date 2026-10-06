"use client";

import type { AvailableAction } from "@blueberrychain/bbc-api";
import { useCockpit } from "@/components/cockpit/context";
import { utc } from "@/domain/format";
import { LedgerTable } from "./LedgerTable";
import { KV, PanelTitle, Section, panel } from "./ui";

const TAMPER_CLONE = "BBC_OS.SANDBOX.LEDGER_TAMPER";

function ProofButton({ action, label, command }: { action: AvailableAction | undefined; label: string; command: string }) {
  const { run } = useCockpit();
  if (!action) return null;
  return action.enabled ? (
    <button type="button" className={panel.btnQuiet} onClick={() => run(command)} data-testid={`proof-${command.split(" ")[0]}`}>
      {label}
    </button>
  ) : (
    <span className={panel.note}>{action.disabled_reason}</span>
  );
}

export function EvidencePanel() {
  const { view, now } = useCockpit();
  const find = (a: AvailableAction["action"]) => view.viewer.available_actions.find((x) => x.action === a);
  const verify = find("VERIFY_LEDGER");
  const replay = find("REPLAY_EVIDENCE");
  const exp = find("EXPORT_EVIDENCE_PACK");
  const { ledger } = view.evidence;
  const anyProof = verify || replay || exp;
  return (
    <>
      <PanelTitle
        title="Evidence"
        lead="The proof behind the decision: sealed evidence packs that can be rebuilt as of their time, and a hash chain anyone with the auditor role can recompute in Snowflake."
      />
      <Section title="Proof" id="proof" aside={view.evidence.sealed ? `Case sealed ${utc(view.evidence.sealed_at, now)}` : "Case still open"}>
        {anyProof ? (
          <div className={panel.actions}>
            <ProofButton action={verify} label="Verify the ledger" command="verify" />
            <ProofButton action={verify} label="Verify the tampered clone" command={`verify --table ${TAMPER_CLONE}`} />
            <ProofButton action={replay} label="Replay the current pack" command="replay" />
            <ProofButton action={exp} label="Export the evidence pack" command="export" />
          </div>
        ) : (
          <p className={panel.note}>Proof is run by the auditor (export also by Finance). Your role, {view.viewer.role}, can read it here.</p>
        )}
        <p className={panel.note} style={{ marginTop: 8 }}>
          Results appear in the console below. Verification recomputes every hash inside Snowflake; this page never checks its own copy.
        </p>
      </Section>
      <Section title="Evidence packs" id="packs">
        {view.analysis.packs.length ? (
          <table className={panel.table}>
            <thead>
              <tr>
                <th scope="col">Pack</th>
                <th scope="col">Decision</th>
                <th scope="col">Evidence as of</th>
                <th scope="col">Sealed</th>
                <th scope="col">Content hash</th>
              </tr>
            </thead>
            <tbody>
              {view.analysis.packs.map((p) => (
                <tr key={p.pack_id}>
                  <td className="id">{p.pack_id}</td>
                  <td>{p.decision_point} revision {p.revision}</td>
                  <td className="num">{utc(p.as_of, now)}</td>
                  <td className="num">{utc(p.sealed_at, now)}</td>
                  <td className={panel.hash}>{p.content_hash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className={panel.note}>No pack has been sealed yet.</p>
        )}
      </Section>
      <Section title="Ledger" id="ledger" aside={ledger.first_seq ? `seq ${ledger.first_seq} to ${ledger.last_seq}${ledger.truncated ? ", truncated" : ""}` : undefined}>
        <KV items={[["Entries for this case", String(ledger.entries.length)], ["Policy", `v${view.governance.policy.policy_version}`]]} />
        <div style={{ marginTop: 12 }}>
          <LedgerTable entries={ledger.entries} chain />
        </div>
      </Section>
    </>
  );
}
