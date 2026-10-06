/** JSON-line logs: ids, hashes, durations and outcomes only. Never tokens, payloads or agent text. */

export type LogFields = Record<string, string | number | boolean | null | undefined>;
export type Logger = (level: "info" | "warn" | "error", event: string, fields?: LogFields) => void;

export const jsonLogger: Logger = (level, event, fields = {}) => {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
};

export const silentLogger: Logger = () => {};
