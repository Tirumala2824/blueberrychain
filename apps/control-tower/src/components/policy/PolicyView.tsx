"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivePolicy } from "@blueberrychain/bbc-api";
import { ApiError, apiGet } from "@/client/api";
import { useSession } from "@/client/session";
import { Problem } from "@/components/common/Problem";
import { ConsoleDock, type ConsoleHandle } from "@/components/console/ConsoleDock";
import { KV, PanelTitle, Section, panel } from "@/components/panels/ui";
import { humanizeCode } from "@/console/templates";
import { roleName, utc } from "@/domain/format";

/**
 * The active policy, read-only. Snowflake grants GOV reads to the governance admin only,
 * so other people see why it isn't shown rather than a copy from somewhere else.
 */
export function PolicyView() {
  const { state } = useSession();
  const [policy, setPolicy] = useState<ActivePolicy | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const consoleRef = useRef<ConsoleHandle>(null);
  const isAdmin = state?.identity?.role === "BBC_GOVERNANCE_ADMIN";

  useEffect(() => {
    apiGet<{ policy: ActivePolicy | null }>("/api/policy")
      .then((b) => setPolicy(b.policy))
      .catch((e: unknown) => setError(e instanceof ApiError ? e : null));
  }, []);

  const doc = policy?.document;
  return (
    <>
      <PanelTitle title="Policy" lead="The rules Snowflake applies to every decision: who may approve what, how much may run on its own, and the kill switches. Read-only here; policies change only by draft and activation in Snowflake, by two different people.">
        {isAdmin && (
          <button type="button" className={panel.btnDanger} onClick={() => consoleRef.current?.prefill('stop-dispatch reason "')} data-testid="emergency-stop">
            Emergency stop…
          </button>
        )}
      </PanelTitle>
      {error && (error.error === "interface_unavailable" && !isAdmin ? (
        <p className={panel.note}>
          Snowflake lets only the governance admin role read the policy tables. Each case shows the policy version and kill switches that applied to it.
        </p>
      ) : (
        <Problem error={error} what="The active policy" />
      ))}
      {policy && doc && (
        <>
          <Section title={`Version ${policy.policy_version}`} id="policy-version">
            <KV
              items={[
                ["Activated", `${utc(policy.activated_at)} by ${policy.activated_by}`],
                ["Drafted", `${utc(policy.drafted_at)} by ${policy.drafted_by}`],
                ["Reason", policy.activation_reason ?? "–"],
                ["Content hash", <span key="h" className={panel.hash}>{policy.content_hash}</span>],
              ]}
            />
          </Section>
          <Section title="Kill switches" id="kill-switches">
            <KV
              items={Object.entries(doc.parameters)
                .filter(([k]) => ["autonomy_ceiling", "shadow_mode", "fallback_enabled", "dispatch_enabled"].includes(k))
                .map(([k, v]) => [humanizeCode(k), String(v)])}
            />
          </Section>
          <Section title="Decision rights" id="decision-rights" aside="Evaluated in priority order; any deny wins">
            <table className={panel.table}>
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">When</th>
                  <th scope="col">Then</th>
                  <th scope="col">Note</th>
                </tr>
              </thead>
              <tbody>
                {doc.decision_rights.map((r) => (
                  <tr key={r.rule_id}>
                    <td className="id">{r.rule_id}</td>
                    <td>
                      {Object.entries(r.conditions).map(([k, v]) => (
                        <div key={k}>
                          {humanizeCode(k)}: {Array.isArray(v) ? v.join(", ") : String(v)}
                        </div>
                      ))}
                      {!Object.keys(r.conditions).length && <span className="faint">always</span>}
                    </td>
                    <td>
                      {humanizeCode(r.outcome)}
                      {r.required_roles.length > 0 && ` by ${r.required_roles.map(roleName).join(" and ")}`}
                    </td>
                    <td>{r.note ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Autonomy thresholds" id="thresholds" aside="Inside the L3 limit an action may run on its own; inside L4 it needs the named approver">
            <table className={panel.table}>
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Measure</th>
                  <th scope="col" className={panel.r}>Runs on its own up to</th>
                  <th scope="col" className={panel.r}>Approval up to</th>
                  <th scope="col">Beyond that</th>
                  <th scope="col">Approver</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(doc.autonomy_thresholds).flatMap(([dim, rules]) =>
                  (rules as { metric: string; l3_max: unknown; l4_max?: unknown; beyond_l4?: string; approver_roles?: string[] }[]).map((t) => (
                    <tr key={`${dim}-${t.metric}-${String(t.l3_max)}`}>
                      <td>{humanizeCode(dim)}</td>
                      <td>{humanizeCode(t.metric)}</td>
                      <td className={`${panel.r} num`}>{String(t.l3_max)}</td>
                      <td className={`${panel.r} num`}>{t.l4_max === undefined || t.l4_max === null ? "–" : String(t.l4_max)}</td>
                      <td>{t.beyond_l4 ? humanizeCode(t.beyond_l4) : "–"}</td>
                      <td>{(t.approver_roles ?? []).map(roleName).join(", ") || "–"}</td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </Section>
          <Section title="Actions the gateway can take" id="action-types">
            <table className={panel.table}>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">System</th>
                  <th scope="col">Undo</th>
                  <th scope="col" className={panel.r}>Highest level</th>
                  <th scope="col">Compensated by</th>
                </tr>
              </thead>
              <tbody>
                {doc.action_types.map((a) => (
                  <tr key={a.action_type}>
                    <td>{humanizeCode(a.action_type)}</td>
                    <td>{a.target_system}</td>
                    <td>{humanizeCode(a.reversibility).toLowerCase()}</td>
                    <td className={`${panel.r} num`}>L{a.max_level}</td>
                    <td>{a.compensation ? humanizeCode(a.compensation) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Agents and models" id="models" aside="The auditor must run on a different model than the author">
            <table className={panel.table}>
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Model</th>
                  <th scope="col">Must differ from the author</th>
                </tr>
              </thead>
              <tbody>
                {doc.model_registry.map((m) => (
                  <tr key={`${m.agent}-${m.model}`}>
                    <td>{humanizeCode(m.agent)}</td>
                    <td>{m.provider}</td>
                    <td className="id">{m.model}</td>
                    <td>{m.must_differ_from_author ? "yes" : "no"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        </>
      )}
      <div style={{ marginTop: 24 }}>
        <ConsoleDock ref={consoleRef} caseId={null} view={null} />
      </div>
    </>
  );
}
