/** Builders for RAW rows: they compute the idempotency key so no connector gets it wrong. */

import { businessEventKey, telemetryKey, validate } from "@blueberrychain/shared";
import type { BusinessEventRow, RawRow, RawTarget, TelemetryRow } from "./types.js";

export type Provenance = NonNullable<TelemetryRow["provenance"]>;

export function telemetryRow(input: {
  connectorId: string;
  deviceId: string;
  readingTs: string;
  intervalS: number;
  readings: TelemetryRow["readings"];
  provenance?: Provenance;
}): TelemetryRow {
  return {
    device_id: input.deviceId,
    reading_ts: input.readingTs,
    interval_s: input.intervalS,
    idempotency_key: telemetryKey(input.deviceId, input.readingTs),
    connector_id: input.connectorId,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    readings: input.readings,
  };
}

export function businessEventRow(input: {
  connectorId: string;
  sourceSystem: BusinessEventRow["source_system"];
  entityType: BusinessEventRow["entity_type"];
  externalId: string;
  eventTs: string;
  payload: Record<string, unknown>;
  provenance?: Provenance;
}): BusinessEventRow {
  return {
    source_system: input.sourceSystem,
    entity_type: input.entityType,
    external_id: input.externalId,
    event_ts: input.eventTs,
    idempotency_key: businessEventKey(input.sourceSystem, input.entityType, input.externalId, input.eventTs),
    connector_id: input.connectorId,
    ...(input.provenance ? { provenance: input.provenance } : {}),
    payload: input.payload,
  } as BusinessEventRow;
}

export const SCHEMAS: Record<RawTarget, string> = {
  TELEMETRY: "raw/telemetry_reading.json",
  BUSINESS_EVENTS: "raw/business_event.json",
};

/**
 * The same row checks API.INGEST_BATCH applies (bbc_toolkit.ingest.prepare): contract,
 * connector id and a recomputed idempotency key. Empty array = the server will accept it.
 */
export function rowProblems(target: RawTarget, connectorId: string, row: RawRow): string[] {
  const errors = validate(SCHEMAS[target], row).map((e) => `${e.path}: ${e.message}`);
  if (errors.length) return errors;
  if (row.connector_id !== connectorId) {
    errors.push(`/connector_id: ${row.connector_id} does not match the caller's ${connectorId}`);
  }
  try {
    const expected =
      target === "TELEMETRY"
        ? telemetryKey((row as TelemetryRow).device_id, (row as TelemetryRow).reading_ts)
        : businessEventKey(
            (row as BusinessEventRow).source_system,
            (row as BusinessEventRow).entity_type,
            (row as BusinessEventRow).external_id,
            (row as BusinessEventRow).event_ts,
          );
    if (row.idempotency_key !== expected) errors.push(`/idempotency_key: expected ${expected}`);
  } catch (error) {
    errors.push(`timestamp: ${(error as Error).message}`);
  }
  return errors;
}
