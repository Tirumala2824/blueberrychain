# ADR-0005: Mock SAP S/4HANA and TMS / carrier systems

- **Status:** Accepted (the contracts themselves are frozen on Day 2 in `contracts/apis/`)
- **Date:** 2026-10-06
- **Depends on:** plan tasks 2.3, 4.1, 4.2, 7.3, 12.1

## Context
- No real SAP system or carrier platform is available.
- The demo must still read from, and write back to, systems of record through **real API shapes**, so that switching to real endpoints is a configuration change rather than a rewrite.

## Decision
- **`apps/mock-s4`** implements an **OData v2 subset** of the public S/4HANA APIs, with SAP's JSON envelope (`d.results`), `$filter`, `$top`, `$skip`, `$select`, and the `x-csrf-token` fetch-then-modify flow. The delta field is `LastChangeDateTime`.

| API | Used for |
|---|---|
| `API_SALES_ORDER_SRV` (A_SalesOrder, A_SalesOrderItem) | Order lines; item changes (lot / qty / date) |
| `API_OUTBOUND_DELIVERY_SRV` | Delivery / lot assignment |
| `API_MATERIAL_STOCK_SRV` | Stock by plant / batch / status |
| `API_INSPECTIONLOT_SRV` | QC results (receipt QC = outcome evidence) |
| `API_MATERIAL_DOCUMENT_SRV` | Goods movement **344** (unrestricted → blocked) and **343** (reverse) |
| `API_SUPPLIERINVOICE_PROCESS_SRV` (simplified) | Grower deductions as supplier credit memos (`IsInvoice = false`), reversal via `Cancel` |

**Amendment (Day 2):**
- **Re-route and processor sales** create a new sales order. The action type `PROCESSOR_SALE` is generalized to **`SO_CREATE`** (compensation `CANCEL_SO`).
- **Customer re-promise notices** (EDI 865) go through a **mock EDI gateway hosted in `apps/mock-tms`** (`/edi/v1/messages`).
- **The full contracts** are in `contracts/apis/mock-s4.odata.md` and `contracts/apis/mock-tms.openapi.yaml` (validated with `openapi-spec-validator`).

- **`apps/mock-tms`** is a REST API (OpenAPI 3.1): shipments, status events, custody / handoff events, re-route instructions, claims and claim responses, plus webhooks.
- **Idempotency:**
  - Every write accepts an **`Idempotency-Key`** header (mock-tms), or our reference in a document field (mock-s4: `YY1_BBCReference` / header text).
  - Both support **lookup by key**, so the dispatcher can ask "did this already happen?" before retrying.
- **Built in TypeScript (Fastify).** State is in memory, with a JSON snapshot for `bbc demo reset`.
- The simulator drives both mocks through their public APIs.
- **Behavior is rule-based, not scripted:**
  - the mocks return realistic errors (CSRF expiry, locked document, period closed);
  - the carrier responds to claims with rule-based defenses: warm loading, setpoint not on the BOL, liability cap.

## Consequences
- Connector and dispatcher code is written against real contract shapes. Contract tests run against the mocks.
- The mocks implement only the fields we use. Extending them means adding fields to the contract first.

## Alternatives considered
- **Calling SAP's public sandbox:** rejected. It's read-only, rate-limited, and has no write-back.
- **Stubbing at the connector level:** rejected. It would hide integration behavior, such as retries and idempotency, from the demo and the tests.
