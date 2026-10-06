# Dispatch targets: payloads and observable state

**Produced by** Snowflake's mutation gateway (`snowflake/modules/83_gateway.sql`): `API.EXECUTE_PLAN` composes each intent from the approved bundle (`bbc_toolkit.stages.bundle_actions`), and `DECISION.MUTATE` fills in `expected_before` and `expected_after` (`bbc_toolkit.gateway.expectations`). **Carried out by** the action handlers in `packages/connector-carrier/src/actions.ts` (TMS, carrier, customer EDI) and `packages/connector-sap-s4/src/actions.ts` (SAP). **Consumed by** the engine's dispatcher (`packages/engine/src/dispatch.ts`).

Intents use BlueberryChain ids (shipment, lot, site, order line). The handlers map them to each target's keys with the ingest connectors' own identities, so the mapping is the same in both directions:
- the SAP batch is the lot id;
- a SAP plant is the site in the SAP key map (`BBC_SAP_KEY_MAP`, `packages/connector-sap-s4/src/keymap.ts`);
- an order line is `SO-<SalesOrder>-<SalesOrderItem>` (`packages/connector-sap-s4/src/mapping.ts`).

Each handler reports the fields the gateway's expectations name (the tables below), plus a few extra ones for the person reading the mutation card. Snowflake compares only the expected fields.

## How the dispatcher uses these fields
1. **On a retried lease** (`attempt > 1`), or when settling an outcome it didn't know, it first asks the target for the key's status. If the key has already been applied, it reads the target back.
2. **Before writing**, it reads the target and compares `expected_before` with what the handler observed.
   - Only fields the handler reports are compared. A field the target can't show is skipped, not assumed.
   - On a mismatch nothing is written; the ACK carries `error.code = PRECONDITION`.
3. **It writes once**, with the idempotency key, sent both as the `Idempotency-Key` header and as the target's reference field.
4. **On a timeout or network error**, it asks for the key's status instead of resending. If the status is still unknown it sends **no ACK**: the mutation stays `PREPARED`, and the dispatcher asks the target again on its next tick.
5. **After writing**, it reads the target back.
6. **A definitive refusal** (closed window, ETag changed, stock deficit) is passed on with the target's HTTP status as `error.code` (`409`, `412`, `422`…). An intent a handler can't carry out as composed is passed on as `INTENT_INCOMPLETE`, before anything is written.

The ACK (`api/mutation_ack.json`: `observed_before`, `observed_after`, `error`, `external_ref`, `dispatched_at`, `target_reported_at`) goes to `API.ACK_MUTATION(mutation_id, attempt, ack)`. **Snowflake decides the status:**
- an error with code `PRECONDITION`, `409` or `412` → `ABORTED_PRECONDITION`;
- any other error → `FAILED`;
- `observed_before` differing from `expected_before` → `ABORTED_PRECONDITION`;
- `observed_after` missing, or differing from `expected_after` → `FAILED`;
- otherwise `VERIFIED`.

## Actions the gateway dispatches
`bbc_toolkit.gateway.DISPATCHABLE` lists `REROUTE`, `REPLACEMENT_ALLOCATION`, `CLAIM_NOTICE`, `STOCK_BLOCK` and `SO_CHANGE`. Any other action is refused at validation and never reaches the dispatcher. For an `ALL_OR_NOTHING` plan, the gateway compensates the verified steps, in reverse order, with the action in the last column. A compensation's payload is the original payload plus `restore` (the original's `expected_before`), and its expectations are the original's, swapped.

| Action | Target | Payload | Expected before → after | Handler writes | Compensation |
|---|---|---|---|---|---|
| `REROUTE` | TMS `SHIPMENT` / shipment id | `shipment_id`, `lot_id`, `new_destination_site_id`, `disposition` | `status: IN_TRANSIT`, `destination_site_id` → `destination_site_id` | `POST /v1/shipments/{id}/reroute` with `If-Match` | `REROUTE_BACK`, to `restore.destination_site_id` |
| `REPLACEMENT_ALLOCATION` | SAP `SALES_ORDER_ITEM` / order line id | `order_line_id`, `replacement_lot_id`, `from_site_id`, `kg` | `assigned_lot_id` → `assigned_lot_id` | `PATCH A_SalesOrderItem` `Batch` with `If-Match` | `DEALLOCATE`, `Batch` back to `restore.assigned_lot_id` |
| `SO_CHANGE` | SAP `SALES_ORDER_ITEM` / order line id | `order_line_id`, `kg` | `kg` → `kg` | `PATCH A_SalesOrderItem` `RequestedQuantity` with `If-Match` | `SO_REVERT`, to `restore.kg` |
| `STOCK_BLOCK` | SAP `LOT_STOCK` / `<lot>@<site>` | `lot_id`, `site_id`, `kg` | `blocked: false` → `blocked: true` | goods movement `344` (unrestricted → blocked) | `STOCK_UNBLOCK`, movement `343` |
| `CLAIM_NOTICE` | CARRIER `CLAIM` / `<case>:<carrier party>` | `counterparty_party_id`, `basis`, `shipment_id` | `notice_on_file: false` → `notice_on_file: true` | `POST /v1/claims` (`notice_only`) | `WITHDRAW_NOTICE` (see gaps) |

**What the handlers observe:**
- **Shipment:** `status`, `destination_site_id`.
- **Sales order item:** `kg` (`RequestedQuantity`), `assigned_lot_id` (`Batch`), `requested_delivery_date`.
- **Lot stock** at the site's plant: `blocked` (any blocked stock of the batch), `unrestricted_kg`, `blocked_kg`.
- **Claim notice:** `notice_on_file` (our notice, found by its reference, and not withdrawn), `claim_status`.

**Status lookups (before any resend):**
- re-routes: `GET /v1/reroutes?reference=<key>`;
- claims: `GET /v1/claims?reference=<key>`;
- stock movements: `A_MaterialDocumentHeader` with `MaterialDocumentHeaderText eq '<ref>'`;
- sales order items: `YY1_BBCReference` on the item equals `<ref>`.

SAP references are the first 25 characters of the key. Every SAP write first gets a CSRF token and session cookie (`x-csrf-token: Fetch`), refreshed once if SAP answers `403 Required`.

**Compare-and-set.** A handler keeps the `ETag` from its before-read and sends it as `If-Match`: the TMS shipment, or the SAP sales order item. If the entity changed in between, the target answers `412`. Once the junction is passed, the TMS answers `409` ("Re-route window closed").

## Further handlers (not dispatched by the gateway today)
- **D2 claims:** `FILE_CLAIM` (`shipment_id`, `amount_usd`, `basis`, optional `carrier_claim_id` → `claim_status`, `amount_usd`) and `WITHDRAW_CLAIM` (`carrier_claim_id` → `claim_status`).
- **Customer EDI** (`CUSTOMER_EDI`): `REPROMISE_NOTICE` and `CORRECTION_NOTICE`, an X12 865 through `POST /edi/v1/messages`. They observe `delivery_status` and `promised_at`.
- **Carrier:** `REQUEST_EVIDENCE`, which observes `request_status` and `evidence_type`.

## Gaps
- **`WITHDRAW_NOTICE` needs the carrier's claim id.** The gateway's compensation intent carries the original payload and `compensation_of`, but not the original mutation's `external_ref`. Until it does (for example as `payload.carrier_claim_id`), the handler reports `INTENT_INCOMPLETE`, and Snowflake records the compensation as `FAILED`.
- **`REPLACEMENT_ALLOCATION` reassigns the order line's lot.** That is the state the gateway verifies (`assigned_lot_id`). It doesn't create the outbound delivery from `from_site_id`; the mock and its contract support that as an `A_OutbDeliveryHeader` deep insert, but nothing observes it yet.
- **`CLAIM_NOTICE` carries no claimant.** The carrier contract asks for `claimant_party_id`, and the intent doesn't have it; the mock doesn't require it.
- **Not implemented for SAP:** `SO_CREATE`, `CANCEL_SO`, `GROWER_DEDUCTION`, `REVERSAL_POSTING`, `ABSORB` and `DISPOSE`. The gateway doesn't dispatch them either. The mock and `mock-s4.odata.md` already support the first two.
- **Carrier:** accepting or countering a settlement offer (`POST /v1/claims/{id}/messages`). It needs an action type in `GOV.ACTION_TYPES` first; today none exists for it.
