"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { CaseView } from "@blueberrychain/bbc-api";
import { celsius, partyName, utc } from "@/domain/format";
import styles from "./charts.module.css";

type Thermal = CaseView["analysis"]["thermal"][number];
type Bucket = Thermal["buckets"][number];

export interface CustodySpan {
  party: string;
  type: string | null;
  from: string;
  to: string | null;
}

export interface Marker {
  at: string;
  label: string;
}

export interface ClaimMark {
  at: string;
  value: number;
  sensor: number | null;
  verdict: string;
  label: string;
}

const W = 880;
const H = 280;
const PAD = { l: 46, r: 18, t: 34, b: 30 };
const BUCKET_MS = 15 * 60_000;

/** Custody spans from the pack, or from where the holder changes in the buckets. */
function spansFrom(buckets: Bucket[], custody: CustodySpan[] | null): CustodySpan[] {
  if (custody?.length) return custody;
  const out: CustodySpan[] = [];
  for (const b of buckets) {
    const last = out.at(-1);
    if (last && last.party === b.holder_party_id) last.to = new Date(Date.parse(b.start) + BUCKET_MS).toISOString();
    else out.push({ party: b.holder_party_id, type: b.holder_type, from: b.start, to: new Date(Date.parse(b.start) + BUCKET_MS).toISOString() });
  }
  return out;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
}

/**
 * Pulp temperature of one lot, banded by who held it: the evidence a liability position
 * rests on. Every value drawn comes from OPS.LOT_THERMAL_BUCKETS and the sealed pack.
 */
export function TemperatureChart({ thermal, custody, markers, claims }: { thermal: Thermal; custody: CustodySpan[] | null; markers: Marker[]; claims: ClaimMark[] }) {
  const titleId = useId();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const buckets = thermal.buckets;
  const geo = useMemo(() => {
    if (!buckets.length) return null;
    const t0 = Date.parse(buckets[0]!.start);
    const t1 = Date.parse(buckets.at(-1)!.start) + BUCKET_MS;
    const temps = [...buckets.flatMap((b) => [b.min_pulp_c, b.max_pulp_c]), thermal.threshold_c, ...claims.flatMap((c) => [c.value, c.sensor ?? c.value])];
    const lo = Math.floor(Math.min(...temps) - 0.5);
    const hi = Math.ceil(Math.max(...temps) + 0.5);
    const x = (ms: number) => PAD.l + ((ms - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (c: number) => PAD.t + ((hi - c) / (hi - lo)) * (H - PAD.t - PAD.b);
    return { t0, t1, lo, hi, x, y };
  }, [buckets, claims, thermal.threshold_c]);

  if (!geo) return <p className={styles.empty}>No readings have been assigned to this lot yet.</p>;
  const { t0, t1, lo, hi, x, y } = geo;
  const spans = spansFrom(buckets, custody).filter((s) => Date.parse(s.to ?? new Date(t1).toISOString()) > t0 && Date.parse(s.from) < t1);
  const mid = (b: Bucket) => x(Date.parse(b.start) + BUCKET_MS / 2);

  const envelope = [
    ...buckets.map((b) => `${mid(b)},${y(b.max_pulp_c)}`),
    ...[...buckets].reverse().map((b) => `${mid(b)},${y(b.min_pulp_c)}`),
  ].join(" ");
  const maxLine = buckets.map((b, i) => `${i ? "L" : "M"}${mid(b)},${y(b.max_pulp_c)}`).join(" ");
  const breach = buckets.map((b) => `${mid(b)},${y(Math.max(b.max_pulp_c, thermal.threshold_c))}`);
  const breachArea = `${mid(buckets[0]!)},${y(thermal.threshold_c)} ${breach.join(" ")} ${mid(buckets.at(-1)!)},${y(thermal.threshold_c)}`;

  const yStep = niceStep(hi - lo, 6);
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / yStep) * yStep; v <= hi; v += yStep) yTicks.push(Number(v.toFixed(2)));
  const hours = (t1 - t0) / 3_600_000;
  const xStepH = hours > 30 ? 6 : hours > 14 ? 3 : hours > 6 ? 2 : 1;
  const xTicks: number[] = [];
  const firstHour = Math.ceil(t0 / 3_600_000) * 3_600_000;
  for (let t = firstHour; t <= t1; t += 3_600_000) if (new Date(t).getUTCHours() % xStepH === 0) xTicks.push(t);

  const pick = (clientX: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = ((clientX - rect.left) / rect.width) * W;
    const ms = t0 + ((svgX - PAD.l) / (W - PAD.l - PAD.r)) * (t1 - t0);
    const i = Math.min(buckets.length - 1, Math.max(0, Math.floor((ms - t0) / BUCKET_MS)));
    setHover(i);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === "ArrowRight") setHover((h) => Math.min(buckets.length - 1, (h ?? -1) + 1));
    else if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? buckets.length) - 1));
    else if (e.key === "Escape") setHover(null);
    else return;
    e.preventDefault();
  };
  const hb = hover === null ? null : buckets[hover]!;
  const tipLeft = hb ? (mid(hb) / W) * 100 : 0;
  const shownMarkers = markers.filter((m) => Date.parse(m.at) >= t0 && Date.parse(m.at) <= t1).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <figure className={styles.figure}>
      <figcaption id={titleId} className={styles.caption}>
        Pulp temperature of lot <span className="id">{thermal.lot_id}</span>, worst reading per 15 minutes, against the {celsius(thermal.threshold_c)} threshold
      </figcaption>
      <div className={styles.plotWrap}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={styles.svg}
          role="img"
          aria-labelledby={titleId}
          tabIndex={0}
          onPointerMove={(e: PointerEvent<SVGSVGElement>) => pick(e.clientX)}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          data-testid={`temperature-chart-${thermal.lot_id}`}
        >
          {spans.map((s, i) => {
            const a = x(Math.max(t0, Date.parse(s.from)));
            const b = x(Math.min(t1, s.to ? Date.parse(s.to) : t1));
            return (
              <g key={`${s.party}-${s.from}`}>
                <rect x={a} y={PAD.t} width={Math.max(0, b - a)} height={H - PAD.t - PAD.b} className={i % 2 ? styles.bandB : styles.bandA} />
                {i > 0 && <line x1={a} x2={a} y1={PAD.t - 22} y2={H - PAD.b} className={styles.handoff} />}
                <text x={a + 6} y={PAD.t - 18} className={styles.bandLabel}>
                  {partyName(s.party)}
                  <tspan className={styles.bandType}> {(s.type ?? "").toLowerCase()}</tspan>
                </text>
                {i > 0 && (
                  <text x={a + 6} y={PAD.t - 6} className={styles.tick}>
                    handed over {utc(s.from)}
                  </text>
                )}
              </g>
            );
          })}
          {yTicks.map((v) => (
            <g key={`y${v}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={styles.grid} />
              <text x={PAD.l - 6} y={y(v) + 4} className={styles.yTick}>{`${v}°`}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} className={styles.grid} />
              <text x={x(t)} y={H - PAD.b + 16} className={styles.xTick}>
                {new Date(t).toISOString().slice(11, 16)}
              </text>
            </g>
          ))}
          <polygon points={breachArea} className={styles.breachArea} />
          <polygon points={envelope} className={styles.envelope} />
          <path d={maxLine} className={styles.line} />
          <line x1={PAD.l} x2={W - PAD.r} y1={y(thermal.threshold_c)} y2={y(thermal.threshold_c)} className={styles.threshold} />
          <text x={PAD.l + 6} y={y(thermal.threshold_c) - 5} className={styles.thresholdLabel}>
            {celsius(thermal.threshold_c)} threshold
          </text>
          {shownMarkers.map((m, i) => (
            <g key={`${m.label}-${m.at}`}>
              <line x1={x(Date.parse(m.at))} x2={x(Date.parse(m.at))} y1={PAD.t + 4 + (i % 3) * 14} y2={H - PAD.b} className={styles.marker} />
              <text x={x(Date.parse(m.at)) - 4} y={PAD.t + 14 + (i % 3) * 14} className={styles.markerLabel}>
                {m.label}
              </text>
            </g>
          ))}
          {claims.map((c) => {
            const cx = x(Date.parse(c.at));
            const cy = y(c.value);
            const tone = c.verdict === "CONFLICT" ? styles.claimConflict : c.verdict === "CONSISTENT" ? styles.claimOk : styles.claimUnknown;
            return (
              <g key={`${c.label}-${c.at}`}>
                {c.sensor !== null && <line x1={cx} x2={cx} y1={cy} y2={y(c.sensor)} className={styles.claimGap} />}
                {c.sensor !== null && <circle cx={cx} cy={y(c.sensor)} r={4} className={styles.sensorDot} />}
                <path d={`M${cx},${cy - 7} L${cx + 7},${cy} L${cx},${cy + 7} L${cx - 7},${cy} Z`} className={`${styles.claim} ${tone}`} />
                <text x={cx > W * 0.65 ? cx - 10 : cx + 10} y={cy - 10} className={styles.claimLabel} textAnchor={cx > W * 0.65 ? "end" : "start"}>
                  {c.label}: {celsius(c.value)}
                  {c.sensor !== null && ` (probe ${celsius(c.sensor)})`}
                </text>
              </g>
            );
          })}
          {hb && (
            <g>
              <line x1={mid(hb)} x2={mid(hb)} y1={PAD.t} y2={H - PAD.b} className={styles.crosshair} />
              <circle cx={mid(hb)} cy={y(hb.max_pulp_c)} r={4.5} className={styles.hoverDot} />
            </g>
          )}
        </svg>
        {hb && (
          <div className={styles.tooltip} style={{ left: `${tipLeft}%` }} role="status" data-testid="chart-tooltip">
            <div className={`num ${styles.tipValue}`}>{celsius(hb.max_pulp_c)} warmest</div>
            <div className="num">{celsius(hb.min_pulp_c)} coolest, {hb.breach_min} of {hb.reading_min} minutes above threshold</div>
            <div className={styles.tipSub}>
              {utc(hb.start)} to {utc(new Date(Date.parse(hb.start) + BUCKET_MS).toISOString())}, held by {partyName(hb.holder_party_id)}
            </div>
          </div>
        )}
      </div>
      <details className={styles.tableView}>
        <summary>Readings as a table ({buckets.length} fifteen-minute buckets)</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">From</th>
              <th scope="col">Holder</th>
              <th scope="col">Coolest</th>
              <th scope="col">Warmest</th>
              <th scope="col">Minutes above</th>
              <th scope="col">Excess life used (h)</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.start}>
                <td className="num">{utc(b.start)}</td>
                <td>{partyName(b.holder_party_id)}</td>
                <td className="num">{celsius(b.min_pulp_c, 2)}</td>
                <td className="num">{celsius(b.max_pulp_c, 2)}</td>
                <td className="num">{b.breach_min}</td>
                <td className="num">{b.excess_h.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
