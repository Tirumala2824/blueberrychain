import type { ApiError } from "@/client/api";
import styles from "./Problem.module.css";

/** Say what failed and what fixes it. A missing Snowflake interface names its work package. */
export function Problem({ error, what }: { error: ApiError; what: string }) {
  if (error.error === "interface_unavailable") {
    return (
      <div className={styles.box} role="status" data-testid="interface-unavailable">
        <h3>{what} isn't available yet</h3>
        <p>
          Snowflake hasn't granted this identity <span className="id">{String(error.detail["interface"] ?? "the interface")}</span>.
          It is delivered by {error.delivers ?? "a later work package"}. The control tower never works around a missing interface.
        </p>
      </div>
    );
  }
  if (error.error === "signed_out") {
    return (
      <div className={styles.box} role="status">
        <h3>You're signed out</h3>
        <p>Sign in again to continue.</p>
      </div>
    );
  }
  return (
    <div className={`${styles.box} ${styles.bad}`} role="alert">
      <h3>{what} couldn't be loaded</h3>
      <p>{error.message}</p>
    </div>
  );
}
