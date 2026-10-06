"use client";

import type { CaseView } from "@blueberrychain/bbc-api";
import { Cite } from "@/components/common/bits";
import { eliminationText, humanizeCode } from "@/console/templates";
import { days, kg, partyName, prob, usd, usdSigned, utc } from "@/domain/format";
import { panel } from "./ui";
import styles from "./OptionParts.module.css";

type Option = CaseView["options"][number];

/** What the option does, in words built from its bundle. */
export function bundleText(o: Option): string[] {
  const lines = o.bundle.lots.map((l) => `${humanizeCode(l.disposition)} ${l.lot_id} (${kg(l.kg)})${l.destination_site_id ? ` to ${l.destination_site_id.replace(/^SITE-/, "")}` : ""}`);
  for (const r of o.bundle.order_recovery) {
    lines.push(`${humanizeCode(r.action)} ${r.order_line_id}${r.replacement_lot_id ? ` from ${r.replacement_lot_id}` : ""}${r.repromise_at ? `, re-promised for ${utc(r.repromise_at)}` : ""}`);
  }
  for (const f of o.bundle.financial) {
    if (f.action !== "NONE") lines.push(`${humanizeCode(f.action)}${f.counterparty_party_id ? ` with ${partyName(f.counterparty_party_id)}` : ""}${f.amount_usd ? ` for ${usd(f.amount_usd)}` : ""}`);
  }
  return lines;
}

/** How NRV is built for one option: revenue - costs - penalties + recovery (the engine's parts). */
export function NrvParts({ o }: { o: Option }) {
  const f = o.outcome.financial;
  const costs = Object.entries(f.costs).filter(([, v]) => typeof v === "number" && v !== 0) as [string, number][];
  return (
    <table className={styles.parts}>
      <tbody>
        <tr><td>Expected revenue</td><td className="num">{usd(f.expected_revenue_usd)}</td></tr>
        {costs.map(([k, v]) => (
          <tr key={k}><td>{humanizeCode(k.replace(/_usd$/, ""))}</td><td className="num">−{usd(v)}</td></tr>
        ))}
        {f.expected_penalties_usd ? <tr><td>Expected penalties</td><td className="num">−{usd(f.expected_penalties_usd)}</td></tr> : null}
        {f.expected_recovery_usd ? <tr><td>Expected recovery from others</td><td className="num">+{usd(f.expected_recovery_usd)}</td></tr> : null}
        <tr className={styles.total}><td>Expected net recovered value</td><td className="num">{usd(f.expected_nrv_usd)}</td></tr>
        <tr><td>Range (P10 to P90)</td><td className="num">{usd(f.nrv_p10_usd)} to {usd(f.nrv_p90_usd)}</td></tr>
        <tr><td>Versus doing nothing</td><td className="num">{usdSigned(f.value_preserved_vs_default_usd)}</td></tr>
      </tbody>
    </table>
  );
}

export function OptionTable({ options, recommendedId, onCite }: { options: Option[]; recommendedId: string | null; onCite: (id: string) => void }) {
  return (
    <table className={panel.table} data-testid="options-table">
      <thead>
        <tr>
          <th scope="col" className={panel.r}>Rank</th>
          <th scope="col">Option</th>
          <th scope="col" className={panel.r}>P(accepted)</th>
          <th scope="col" className={panel.r}>Shelf life on arrival</th>
          <th scope="col" className={panel.r}>Expected value</th>
          <th scope="col" className={panel.r}>vs do nothing</th>
          <th scope="col" className={panel.r}>Risk-adjusted</th>
          <th scope="col">Expires</th>
        </tr>
      </thead>
      <tbody>
        {options.map((o) => (
          <tr key={o.option_id} className={o.option_id === recommendedId ? panel.emph : o.is_default ? panel.base : undefined} data-option-id={o.option_id}>
            <td className={`${panel.r} num`}>{o.score.rank ?? "–"}</td>
            <td>
              <details className={styles.opt}>
                <summary>
                  <span className={styles.label}>{o.label}</span>
                  <span className={styles.tags}>
                    <span className="id">{o.option_id}</span>
                    {o.option_id === recommendedId && <span className={`${panel.pill} ${panel.info}`}>recommended</span>}
                    {o.is_default && <span className={panel.pill}>do nothing</span>}
                    {o.is_fallback && <span className={`${panel.pill} ${panel.warn}`}>safe fallback</span>}
                    {o.flags.map((f) => <span key={f} className={`${panel.pill} ${panel.warn}`}>{humanizeCode(f).toLowerCase()}</span>)}
                  </span>
                </summary>
                <ul className={styles.bundle}>
                  {bundleText(o).map((l) => <li key={l}>{l}</li>)}
                </ul>
                <NrvParts o={o} />
                <p className="faint">
                  Confidence {o.outcome.confidence.level.toLowerCase()}: {o.outcome.confidence.drivers.join("; ")}. <Cite id={o.evidence_id} onOpen={onCite} />
                </p>
              </details>
            </td>
            <td className={`${panel.r} num`}>{prob(o.outcome.operational.p_accept)}</td>
            <td className={`${panel.r} num`}>{days(o.outcome.operational.sl_at_arrival_days_p50)}</td>
            <td className={`${panel.r} num`}>{usd(o.outcome.financial.expected_nrv_usd)}</td>
            <td className={`${panel.r} num`}>{usdSigned(o.outcome.financial.value_preserved_vs_default_usd)}</td>
            <td className={`${panel.r} num`}>{usd(o.score.risk_adjusted_usd)}</td>
            <td className="num">{utc(o.expires_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function EliminatedList({ options, onCite }: { options: Option[]; onCite: (id: string) => void }) {
  return (
    <ul className={styles.eliminated} data-testid="eliminated">
      {options.map((o) => (
        <li key={o.option_id}>
          <div className={styles.elimHead}>
            <span className={styles.label}>{o.label}</span> <span className="id faint">{o.option_id}</span>
          </div>
          {o.eliminations.map((e) => (
            <p key={e.code}>
              <span className={`${panel.pill} ${panel.bad}`}>{humanizeCode(e.code).toLowerCase()}</span> {eliminationText(e.code)} <span className="muted">{e.detail}</span>
              {e.evidence_id && <Cite id={e.evidence_id} onOpen={onCite} />}
            </p>
          ))}
        </li>
      ))}
    </ul>
  );
}
