import styles from "./Value.module.css";

/** A governed value of any shape, rendered as text (never as markup). */
export function Value({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="faint">none</span>;
  if (typeof value === "number") return <span className="num">{value.toLocaleString("en-US", { maximumFractionDigits: 4 })}</span>;
  if (typeof value === "boolean") return <span>{value ? "yes" : "no"}</span>;
  if (typeof value === "string") return <span className={styles.str}>{value}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <span className="faint">empty</span>;
    if (depth > 3) return <span className="faint">{value.length} items</span>;
    return (
      <ol className={styles.list}>
        {value.map((v, i) => (
          <li key={i}>
            <Value value={v} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (depth > 3) return <span className="faint">{entries.length} fields</span>;
  return (
    <dl className={styles.obj}>
      {entries.map(([k, v]) => (
        <div key={k}>
          <dt>{k.replaceAll("_", " ")}</dt>
          <dd>
            <Value value={v} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
