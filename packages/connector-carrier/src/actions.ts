/**
 * Outbound action handlers for the carrier TMS (contracts/apis/mock-tms.openapi.yaml),
 * used by the engine's dispatcher. Each write carries the mutation's idempotency key as
 * both the Idempotency-Key header and the record's `reference`, so `status` can ask the
 * TMS what happened to a key before anything is ever resent. Payload fields per action
 * are in contracts/apis/dispatch-target-states.md.
 */

import { TargetRejectedError, type ActionHandler, type TargetStatus } from "@blueberrychain/connector-sdk";
import { TmsClient, TmsError, type Json } from "./tms.js";

export interface CarrierIntent {
  action_type: string;
  idempotency_key: string;
  target_entity: { type: string; id: string };
  payload: Json;
  rec_id: string;
  case_id: string;
}

type Response = Awaited<ReturnType<TmsClient["request"]>>;

/** 4xx means the TMS refused; 5xx and network errors leave the outcome unknown. */
function check(r: Response, what: string): Json {
  if (r.status >= 200 && r.status < 300) return r.body;
  const detail = [r.body["title"], r.body["detail"]].filter(Boolean).join(": ") || `HTTP ${r.status}`;
  if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
    throw new TargetRejectedError(r.status, `TMS_${r.status}`, `${what}: ${detail}`);
  }
  throw new TmsError(r.status, `${what}: ${detail}`);
}

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

export function carrierHandlers(tms: TmsClient): ActionHandler<CarrierIntent>[] {
  const etags = new WeakMap<CarrierIntent, string>();

  const shipment = async (id: string) => {
    const r = await tms.request("GET", `/v1/shipments/${encodeURIComponent(id)}`);
    return { body: check(r, `read shipment ${id}`), etag: r.headers.get("etag") ?? "" };
  };
  const byReference = async (path: string, key: string): Promise<Json | null> => {
    const r = await tms.request("GET", `${path}?reference=${encodeURIComponent(key)}`);
    const rows = (check(r, `look up ${path}`)["data"] ?? []) as Json[];
    return rows[0] ?? null;
  };
  const post = (path: string, key: string, body: Json, headers: Record<string, string> = {}) =>
    tms.request("POST", path, { body, headers: { "Idempotency-Key": key, ...headers } });

  const reroute = (actionType: "REROUTE" | "REROUTE_BACK"): ActionHandler<CarrierIntent> => ({
    actionTypes: [actionType],
    targetSystem: "TMS",
    async readBefore(intent) {
      const { body, etag } = await shipment(intent.target_entity.id);
      etags.set(intent, etag);
      return { status: body["status"], destination_site_id: body["destination_site_id"] };
    },
    async execute(intent, key) {
      const etag = etags.get(intent) ?? (await shipment(intent.target_entity.id)).etag;
      const r = await post(`/v1/shipments/${encodeURIComponent(intent.target_entity.id)}/reroute`, key, {
        new_destination_site_id: intent.payload["new_destination_site_id"],
        reason: `BlueberryChain ${intent.rec_id} (${intent.case_id})`,
        reference: key,
      }, { "If-Match": etag });
      const body = check(r, `re-route ${intent.target_entity.id}`);
      return { externalRef: str(body["reroute_id"]), response: body };
    },
    async status(_intent, key): Promise<TargetStatus> {
      const hit = await byReference("/v1/reroutes", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["reroute_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(intent) {
      const { body } = await shipment(intent.target_entity.id);
      return { status: body["status"], destination_site_id: body["destination_site_id"] };
    },
  });

  const claim = (actionType: "CLAIM_NOTICE" | "FILE_CLAIM"): ActionHandler<CarrierIntent> => ({
    actionTypes: [actionType],
    targetSystem: "CARRIER",
    async readBefore(intent) {
      const existing = intent.payload["carrier_claim_id"]
        ? check(await tms.request("GET", `/v1/claims/${encodeURIComponent(str(intent.payload["carrier_claim_id"]))}`), "read claim")
        : null;
      return actionType === "CLAIM_NOTICE"
        ? { notice_open: existing !== null }
        : { claim_status: existing ? (existing["status"] === "NOTICE_RECEIVED" ? "NOTICE_SENT" : existing["status"]) : "NOTICE_SENT" };
    },
    async execute(intent, key) {
      const r = await post("/v1/claims", key, {
        shipment_id: intent.payload["shipment_id"] ?? intent.target_entity.id,
        notice_only: actionType === "CLAIM_NOTICE",
        basis: intent.payload["basis"] ?? null,
        amount_usd: actionType === "FILE_CLAIM" ? intent.payload["amount_usd"] : null,
        reference: key,
      });
      const body = check(r, actionType === "CLAIM_NOTICE" ? "send claim notice" : "file claim");
      return { externalRef: str(body["claim_id"]), response: body };
    },
    async status(_intent, key) {
      const hit = await byReference("/v1/claims", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["claim_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(_intent, externalRef) {
      const body = check(await tms.request("GET", `/v1/claims/${encodeURIComponent(externalRef)}`), "read claim");
      const status = body["status"] === "NOTICE_RECEIVED" ? "NOTICE_SENT" : body["status"];
      return actionType === "CLAIM_NOTICE" ? { notice_open: true, claim_status: status } : { claim_status: status, amount_usd: body["amount_usd"] };
    },
  });

  const withdrawClaim: ActionHandler<CarrierIntent> = {
    actionTypes: ["WITHDRAW_CLAIM", "WITHDRAW_NOTICE"],
    targetSystem: "CARRIER",
    async readBefore(intent) {
      const body = check(await tms.request("GET", `/v1/claims/${encodeURIComponent(str(intent.payload["carrier_claim_id"]))}`), "read claim");
      return { claim_status: body["status"] };
    },
    async execute(intent, key) {
      const id = str(intent.payload["carrier_claim_id"]);
      const body = check(await post(`/v1/claims/${encodeURIComponent(id)}/withdraw`, key, { reference: key }), "withdraw claim");
      return { externalRef: id, response: body };
    },
    async status(intent) {
      const body = check(await tms.request("GET", `/v1/claims/${encodeURIComponent(str(intent.payload["carrier_claim_id"]))}`), "read claim");
      return body["status"] === "WITHDRAWN" ? { state: "APPLIED", externalRef: str(body["claim_id"]) } : { state: "UNKNOWN" };
    },
    async readAfter(_intent, externalRef) {
      const body = check(await tms.request("GET", `/v1/claims/${encodeURIComponent(externalRef)}`), "read claim");
      return { claim_status: body["status"] };
    },
  };

  const evidence: ActionHandler<CarrierIntent> = {
    actionTypes: ["REQUEST_EVIDENCE"],
    targetSystem: "CARRIER",
    async readBefore() {
      return {};
    },
    async execute(intent, key) {
      const body = check(await post("/v1/evidence-requests", key, {
        shipment_id: intent.payload["shipment_id"] ?? intent.target_entity.id,
        evidence_type: intent.payload["evidence_type"],
        note: intent.payload["note"] ?? null,
        reference: key,
      }), "request evidence");
      return { externalRef: str(body["request_id"]), response: body };
    },
    async status(_intent, key) {
      const hit = await byReference("/v1/evidence-requests", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["request_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(intent) {
      const stored = await byReference("/v1/evidence-requests", intent.idempotency_key);
      return stored ? { request_status: stored["status"], evidence_type: stored["evidence_type"] } : {};
    },
  };

  const edi = (actionType: "REPROMISE_NOTICE" | "CORRECTION_NOTICE"): ActionHandler<CarrierIntent> => ({
    actionTypes: [actionType],
    targetSystem: "CUSTOMER_EDI",
    async readBefore() {
      return {};
    },
    async execute(intent, key) {
      const body = check(await post("/edi/v1/messages", key, {
        standard: "X12",
        transaction_set: "865",
        purpose: actionType === "REPROMISE_NOTICE" ? "REPROMISE" : "CORRECTION",
        order_line_id: intent.target_entity.id,
        ...intent.payload,
        reference: key,
      }), "send EDI 865");
      return { externalRef: str(body["message_id"]), response: body };
    },
    async status(_intent, key) {
      const hit = await byReference("/edi/v1/messages", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["message_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(intent) {
      const stored = await byReference("/edi/v1/messages", intent.idempotency_key);
      return stored ? { delivery_status: stored["status"], promised_at: stored["repromise_at"] ?? null } : {};
    },
  });

  return [reroute("REROUTE"), reroute("REROUTE_BACK"), claim("CLAIM_NOTICE"), claim("FILE_CLAIM"), withdrawClaim, evidence, edi("REPROMISE_NOTICE"), edi("CORRECTION_NOTICE")];
}
