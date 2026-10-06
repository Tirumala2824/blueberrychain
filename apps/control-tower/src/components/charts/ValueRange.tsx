"use client";

import { useId, useState } from "react";
import { usd, usdSigned } from "@/domain/format";
import styles from "./charts.module.css";

export interface ValueRow {
  id: string;
  label: string;
  expected: number;
  p10: number;
  p90: number;
  vsDefault: number;
  rank: number | null;
  recommended: boolean;
}

const W = 880;
const ROW = 34;
const PAD = { l: 300, r: 90, t: 30, b: 28 };

function niceStep(range: number): number {
  const raw = range / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

/**
 * What each feasible option is worth: expected net recovered value with its P10 to P90
 * range, against doing nothing. Every number is the engine's; the chart only places it.
 */
export function ValueRange({ rows, baseline }: { rows: ValueRow[]; baseline: { label: string; expected: number } | null }) {
  const titleId = useId();
  const [hover, setHover] = useState<string | null>(null);
  if (!rows.length) return null;
  const values = [...rows.flatMap((r) => [r.p10, r.p90, r.expected]), ...(baseline ? [baseline.expected] : [])];
  const step = niceStep(Math.max(...values) - Math.min(...values) || 1000);
  const lo = Math.floor(Math.min(...values) / step) * step;
  const hi = Math.ceil(Math.max(...values) / step) * step;
  const H = PAD.t + PAD.b + rows.length * ROW;
  const x = (v: number) => PAD.l + ((v - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-6; v += step) ticks.push(v);
  const shown = rows.find((r) => r.id === hover) ?? null;

  return (
    <figure className={styles.figure}>
      <figcaption id={titleId} className={styles.caption}>
        Expected net recovered value of each feasible option, with its P10 to P90 range{baseline ? ", against doing nothing" : ""}
      </figcaption>
      <div className={styles.plotWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="list" aria-labelledby={titleId} data-testid="value-chart">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t - 6} y2={H - PAD.b} className={styles.grid} />
              <text x={x(t)} y={H - PAD.b + 16} className={styles.xTick}>
                {t >= 1000 ? `$${(t / 1000).toLocaleString("en-US")}k` : usd(t)}
              </text>
            </g>
          ))}
          {baseline && (
            <g>
              <line x1={x(baseline.expected)} x2={x(baseline.expected)} y1={PAD.t - 14} y2={H - PAD.b} className={styles.baseline} />
              <text x={x(baseline.expected) + 4} y={PAD.t - 16} className={styles.baselineLabel}>
                Do nothing {usd(baseline.expected)}
              </text>
            </g>
          )}
          {rows.map((r, i) => {
            const cy = PAD.t + i * ROW + ROW / 2;
            return (
              <g
                key={r.id}
                tabIndex={0}
                role="listitem"
                aria-label={`${r.label}: expected ${usd(r.expected)}, P10 ${usd(r.p10)}, P90 ${usd(r.p90)}, ${usdSigned(r.vsDefault)} versus doing nothing`}
                onPointerEnter={() => setHover(r.id)}
                onPointerLeave={() => setHover(null)}
                onFocus={() => setHover(r.id)}
                onBlur={() => setHover(null)}
                className={styles.valueRow}
                data-option-id={r.id}
              >
                <rect x={0} y={cy - ROW / 2} width={W} height={ROW} className={hover === r.id ? styles.rowHit : styles.rowHitIdle} />
                <text x={8} y={cy + 4} className={r.recommended ? styles.rowLabelStrong : styles.rowLabel}>
                  {r.rank ? `${r.rank}. ` : ""}
                  {r.label.length > 44 ? `${r.label.slice(0, 43)}…` : r.label}
                </text>
                <line x1={x(r.p10)} x2={x(r.p90)} y1={cy} y2={cy} className={r.recommended ? styles.rangeRec : styles.range} />
                <circle cx={x(r.expected)} cy={cy} r={5} className={r.recommended ? styles.dotRec : styles.dot} />
                <text x={Math.max(x(r.p90), x(r.expected)) + 10} y={cy + 4} className={styles.valueLabel}>
                  {usd(r.expected)}
                </text>
              </g>
            );
          })}
        </svg>
        {shown && (
          <div className={styles.tooltip} style={{ left: `${(x(shown.expected) / W) * 100}%` }} role="status">
            <div className={`num ${styles.tipValue}`}>{usd(shown.expected)} expected</div>
            <div className="num">
              P10 {usd(shown.p10)}, P90 {usd(shown.p90)}
            </div>
            <div className={`num ${styles.tipSub}`}>{usdSigned(shown.vsDefault)} versus doing nothing</div>
          </div>
        )}
      </div>
    </figure>
  );
}
