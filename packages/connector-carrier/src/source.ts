/**
 * The carrier / TMS pull source.
 *
 * - `shipments` (cursor: updated_at): each change lands as a SHIPMENT record (the plan,
 *   with the destination as planned) and a SHIPMENT_STATUS record (current status,
 *   destination after any re-route, next junction, ETA).
 * - `events` (cursor: recorded_at, so late events are never skipped): STATUS events ->
 *   SHIPMENT_STATUS with position; CUSTODY events -> CUSTODY_EVENT.
 * - `claim_responses` (cursor: recorded_at) -> CLAIM_RESPONSE, with the counterparty
 *   resolved through the claim's shipment.
 */

import { type BusinessEventRow, businessEventRow, type Provenance, type PullPage, type PullSource } from "@blueberrychain/connector-sdk";
import { type Json, type TmsClient, TmsError } from "./tms.js";

export const STREAMS = ["shipments", "events", "claim_responses"] as const;
export type Stream = (typeof STREAMS)[number];

export interface CarrierSourceOptions {
  connectorId: string;
  provenance?: Provenance;
  pageSize?: number;
  onSkip?: (stream: Stream, reason: string, record: Json) => void;
}

function compact(payload: Json): Json {
  return Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== null && v !== undefined && v !== ""));
}

export class CarrierSource implements PullSource<BusinessEventRow> {
  readonly target = "BUSINESS_EVENTS" as const;
  readonly streams = STREAMS;
  readonly skipped: Array<{ stream: Stream; reason: string }> = [];
  private readonly carrierOfShipment = new Map<string, string>();

  constructor(
    private readonly client: TmsClient,
    private readonly options: CarrierSourceOptions,
  ) {}

  private row(entityType: BusinessEventRow["entity_type"], externalId: string, eventTs: string, payload: Json) {
    return businessEventRow({
      connectorId: this.options.connectorId,
      sourceSystem: "TMS",
      entityType,
      externalId,
      eventTs,
      payload,
      ...(this.options.provenance ? { provenance: this.options.provenance } : {}),
    });
  }

  private skip(stream: Stream, reason: string, record: Json) {
    this.skipped.push({ stream, reason });
    this.options.onSkip?.(stream, reason, record);
  }

  async pull(stream: string, cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    switch (stream) {
      case "shipments":
        return this.shipments(cursor);
      case "events":
        return this.events(cursor);
      case "claim_responses":
        return this.claimResponses(cursor);
      default:
        throw new Error(`unknown stream ${stream}`);
    }
  }

  private async shipments(cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    const size = this.options.pageSize ?? 200;
    const page = await this.client.get<{ data: Json[]; next_page_token: string | null }>("/v1/shipments", {
      page_size: String(size),
      ...(cursor ? { updated_since: cursor } : {}),
    });
    const rows: BusinessEventRow[] = [];
    for (const s of page.data) {
      const id = String(s.shipment_id);
      const at = String(s.updated_at);
      this.carrierOfShipment.set(id, String(s.carrier_party_id));
      rows.push(
        this.row("SHIPMENT", id, at, {
          shipment_id: id,
          carrier_party_id: s.carrier_party_id,
          origin_site_id: s.origin_site_id,
          destination_site_id: s.planned_destination_site_id ?? s.destination_site_id,
          planned_departure_at: s.planned_departure_at,
          planned_arrival_at: s.planned_arrival_at,
          reefer_device_id: s.reefer_device_id ?? null,
          bol_setpoint_c: s.bol_setpoint_c ?? null,
          lots: s.lots,
          status: s.status,
        }),
        this.row("SHIPMENT_STATUS", `${id}:${at}`, at, compact({
          shipment_id: id,
          status: s.status,
          at,
          destination_site_id: s.destination_site_id,
          next_junction_site_id: s.junction_passed ? null : s.next_junction_site_id,
          eta_at: s.eta_at,
        })),
      );
    }
    const last = page.data.at(-1);
    return { rows, cursor: last ? String(last.updated_at) : cursor, more: page.data.length === size };
  }

  private async events(cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    const page = await this.client.get<{ data: Json[]; next_page_token: string | null }>("/v1/events", {
      since: cursor ?? "1970-01-01T00:00:00Z",
    });
    const rows: BusinessEventRow[] = [];
    for (const e of page.data) {
      const id = String(e.event_id);
      const at = String(e.at);
      if (e.kind === "STATUS") {
        rows.push(this.row("SHIPMENT_STATUS", id, at, compact({
          shipment_id: e.shipment_id, status: e.status, at, lat: e.lat, lon: e.lon, eta_at: e.eta_at,
        })));
      } else if (e.kind === "CUSTODY") {
        if (!e.custody_event_type || !e.from_party_id || !e.to_party_id) {
          this.skip("events", "custody event without type or parties", e);
          continue;
        }
        rows.push(this.row("CUSTODY_EVENT", id, at, compact({
          event_id: id, event_type: e.custody_event_type, at, shipment_id: e.shipment_id, lot_id: e.lot_id,
          from_party_id: e.from_party_id, to_party_id: e.to_party_id, site_id: e.site_id,
        })));
      }
    }
    const last = page.data.at(-1);
    return { rows, cursor: last ? String(last.recorded_at) : cursor, more: page.next_page_token !== null };
  }

  private async counterpartyOf(claimId: string): Promise<string | null> {
    try {
      const claim = await this.client.get(`/v1/claims/${encodeURIComponent(claimId)}`);
      const shipmentId = String(claim.shipment_id);
      if (!this.carrierOfShipment.has(shipmentId)) {
        const s = await this.client.get(`/v1/shipments/${encodeURIComponent(shipmentId)}`);
        this.carrierOfShipment.set(shipmentId, String(s.carrier_party_id));
      }
      return this.carrierOfShipment.get(shipmentId) ?? null;
    } catch (error) {
      if (error instanceof TmsError && error.status === 404) return null;
      throw error;
    }
  }

  private async claimResponses(cursor: string | null): Promise<PullPage<BusinessEventRow>> {
    const page = await this.client.get<{ data: Json[] }>("/v1/claim-responses", { since: cursor ?? "1970-01-01T00:00:00Z" });
    const rows: BusinessEventRow[] = [];
    for (const r of page.data) {
      const counterparty = await this.counterpartyOf(String(r.claim_id));
      if (!counterparty) {
        this.skip("claim_responses", `unknown claim ${String(r.claim_id)}`, r);
        continue;
      }
      rows.push(this.row("CLAIM_RESPONSE", String(r.response_id), String(r.at), compact({
        response_id: r.response_id, claim_ref: r.claim_id, counterparty_party_id: counterparty,
        response_type: r.response_type, amount_usd: r.amount_usd, defense: r.defense, text: r.text, at: r.at,
      })));
    }
    const last = page.data.at(-1);
    return { rows, cursor: last ? String(last.recorded_at) : cursor, more: false };
  }
}
