/** Formatting only: these never compute a governed number, they present one. */

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const usd = (n: number | null | undefined): string => (n === null || n === undefined ? "–" : usdFmt.format(n));
export const usdSigned = (n: number | null | undefined): string =>
  n === null || n === undefined ? "–" : `${n > 0 ? "+" : n < 0 ? "−" : ""}${usdFmt.format(Math.abs(n))}`;
export const kg = (n: number | null | undefined): string => (n === null || n === undefined ? "–" : `${intFmt.format(n)} kg`);
export const celsius = (n: number | null | undefined, digits = 1): string => (n === null || n === undefined ? "–" : `${n.toFixed(digits)} °C`);
export const prob = (n: number | null | undefined): string => (n === null || n === undefined ? "–" : n >= 0.995 && n < 1 ? n.toFixed(3) : n.toFixed(2));
export const pct = (n: number | null | undefined, digits = 0): string => (n === null || n === undefined ? "–" : `${(n * 100).toFixed(digits)}%`);
export const days = (n: number | null | undefined): string => (n === null || n === undefined ? "–" : `${n.toFixed(1)} days`);

/** "07:21 UTC", with the date when it isn't the reference day. */
export function utc(ts: string | null | undefined, reference?: string | number): string {
  if (!ts) return "–";
  const d = new Date(ts);
  const hm = d.toISOString().slice(11, 16);
  const ref = reference === undefined ? null : new Date(reference).toISOString().slice(0, 10);
  const day = d.toISOString().slice(0, 10);
  return ref && ref !== day ? `${day.slice(5)} ${hm} UTC` : `${hm} UTC`;
}

export const utcSeconds = (ts: string | null | undefined): string => (ts ? `${new Date(ts).toISOString().slice(11, 19)} UTC` : "–");

/** "1 h 53 m", "12 m", "45 s". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(Math.abs(ms) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${String(m % 60).padStart(2, "0")} m`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export type Urgency = "calm" | "soon" | "now" | "over" | "none";

/** How a countdown should look; thresholds are presentation, not policy. */
export function urgency(deadline: string | null | undefined, nowMs: number): Urgency {
  if (!deadline) return "none";
  const left = Date.parse(deadline) - nowMs;
  if (left <= 0) return "over";
  if (left <= 30 * 60_000) return "now";
  if (left <= 2 * 3_600_000) return "soon";
  return "calm";
}

export function countdown(deadline: string | null | undefined, nowMs: number): string {
  if (!deadline) return "No deadline";
  const left = Date.parse(deadline) - nowMs;
  return left <= 0 ? `${duration(left)} overdue` : `${duration(left)} left`;
}

export const roleName = (role: string): string =>
  ({
    BBC_QUALITY_MGR: "Quality",
    BBC_SALES_MGR: "Sales",
    BBC_FINANCE_MGR: "Finance",
    BBC_AUDITOR: "Auditor",
    BBC_GOVERNANCE_ADMIN: "Governance",
  })[role] ?? role;

/** A readable label from a party id (PARTY-EMERALD-RIDGE -> Emerald Ridge); the id stays visible where it matters. */
export const partyName = (id: string | null | undefined): string => {
  if (!id) return "–";
  return id
    .replace(/^PARTY-/, "")
    .toLowerCase()
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
};
