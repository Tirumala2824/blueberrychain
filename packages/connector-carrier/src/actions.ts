/**
 * Outbound action handlers for the carrier TMS (contracts/apis/mock-tms.openapi.yaml),
 * used by the engine's dispatcher. Each write carries the mutation's idempotency key as
 * both the Idempotency-Key header and the record's `reference`, so `status` can ask the
 * TMS what happened to a key before anything is ever resent. Payloads are what the
 * gateway composes, and observations are named after its expectations
 * (contracts/apis/dispatch-target-states.md).
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

/** The intent can't be carried out as composed (nothing is written; the dispatcher reports it). */
const incomplete = (message: string) => new TargetRejectedError(0, "INTENT_INCOMPLETE", message);

/** A compensation's `restore` (the original's expected_before). */
const restored = (p: Json, field: string): unknown => {
  const r = p["restore"] as Json | undefined;
  if (!r || r[field] === undefined) throw incomplete(`the compensation carries no restore.${field}`);
  return r[field];
};

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
      // REROUTE_BACK restores the destination the original re-route moved away from.
      const destination = actionType === "REROUTE" ? intent.payload["new_destination_site_id"] : restored(intent.payload, "destination_site_id");
      const r = await post(`/v1/shipments/${encodeURIComponent(intent.target_entity.id)}/reroute`, key, {
        new_destination_site_id: destination,
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

  const readClaim = async (id: string) => check(await tms.request("GET", `/v1/claims/${encodeURIComponent(id)}`), "read claim");
  const claimStatus = (c: Json | null) => (c ? (c["status"] === "NOTICE_RECEIVED" ? "NOTICE_SENT" : c["status"]) : null);
  const onFile = (c: Json | null) => c !== null && c["status"] !== "WITHDRAWN";

  // CLAIM_NOTICE: payload {counterparty_party_id, basis, shipment_id}; observed {notice_on_file, claim_status}.
  const notice: ActionHandler<CarrierIntent> = {
    actionTypes: ["CLAIM_NOTICE"],
    targetSystem: "CARRIER",
    async readBefore(intent) {
      const ours = await byReference("/v1/claims", intent.idempotency_key);
      return { notice_on_file: onFile(ours), claim_status: claimStatus(ours) };
    },
    async execute(intent, key) {
      const body = check(await post("/v1/claims", key, {
        shipment_id: intent.payload["shipment_id"],
        notice_only: true,
        basis: intent.payload["basis"] ?? null,
        description: `Notice of claim for ${intent.case_id} (${intent.rec_id}), preserving our rights`,
        reference: key,
      }), "send claim notice");
      return { externalRef: str(body["claim_id"]), response: body };
    },
    async status(_intent, key) {
      const hit = await byReference("/v1/claims", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["claim_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(_intent, externalRef) {
      const c = await readClaim(externalRef);
      return { notice_on_file: onFile(c), claim_status: claimStatus(c) };
    },
  };

  // FILE_CLAIM (D2): payload {shipment_id, amount_usd, basis, carrier_claim_id?}; observed {claim_status, amount_usd}.
  const fileClaim: ActionHandler<CarrierIntent> = {
    actionTypes: ["FILE_CLAIM"],
    targetSystem: "CARRIER",
    async readBefore(intent) {
      const existing = intent.payload["carrier_claim_id"] ? await readClaim(str(intent.payload["carrier_claim_id"])) : null;
      return { claim_status: claimStatus(existing) ?? "NOTICE_SENT" };
    },
    async execute(intent, key) {
      const body = check(await post("/v1/claims", key, {
        shipment_id: intent.payload["shipment_id"],
        notice_only: false,
        basis: intent.payload["basis"] ?? null,
        amount_usd: intent.payload["amount_usd"],
        description: `Claim for ${intent.case_id} (${intent.rec_id})`,
        reference: key,
      }), "file claim");
      return { externalRef: str(body["claim_id"]), response: body };
    },
    async status(_intent, key) {
      const hit = await byReference("/v1/claims", key);
      return hit ? { state: "APPLIED", externalRef: str(hit["claim_id"]), detail: hit } : { state: "UNKNOWN" };
    },
    async readAfter(_intent, externalRef) {
      const c = await readClaim(externalRef);
      return { claim_status: claimStatus(c), amount_usd: c["amount_usd"] };
    },
  };

  // WITHDRAW_CLAIM / WITHDRAW_NOTICE: needs the carrier's claim id (payload.carrier_claim_id).
  // A gateway compensation of CLAIM_NOTICE doesn't carry it yet (docs/frontend-spec.md, requests).
  const withdraw = (actionType: "WITHDRAW_CLAIM" | "WITHDRAW_NOTICE"): ActionHandler<CarrierIntent> => {
    const claimId = (intent: CarrierIntent) => {
      const id = intent.payload["carrier_claim_id"] ?? intent.payload["original_external_ref"];
      if (!id) throw incomplete(`${actionType} needs the carrier's claim id (payload.carrier_claim_id)`);
      return str(id);
    };
    const observe = (c: Json) => (actionType === "WITHDRAW_NOTICE" ? { notice_on_file: onFile(c), claim_status: claimStatus(c) } : { claim_status: c["status"] });
    return {
      actionTypes: [actionType],
      targetSystem: "CARRIER",
      readBefore: async (intent) => observe(await readClaim(claimId(intent))),
      async execute(intent, key) {
        const id = claimId(intent);
        const body = check(await post(`/v1/claims/${encodeURIComponent(id)}/withdraw`, key, { reference: key }), "withdraw claim");
        return { externalRef: id, response: body };
      },
      async status(intent) {
        const c = await readClaim(claimId(intent));
        return c["status"] === "WITHDRAWN" ? { state: "APPLIED", externalRef: str(c["claim_id"]) } : { state: "UNKNOWN" };
      },
      readAfter: async (_intent, externalRef) => observe(await readClaim(externalRef)),
    };
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

  return [
    reroute("REROUTE"), reroute("REROUTE_BACK"), notice, fileClaim, withdraw("WITHDRAW_CLAIM"), withdraw("WITHDRAW_NOTICE"),
    evidence, edi("REPROMISE_NOTICE"), edi("CORRECTION_NOTICE"),
  ];
}
