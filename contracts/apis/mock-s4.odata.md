# Mock SAP S/4HANA: OData v2 contract (subset)

**Implemented by** `apps/mock-s4`. **Consumed by** `packages/connector-sap-s4` (inbound) and the engine dispatcher (outbound).

**Modeled on** the public S/4HANA Cloud APIs (`API_SALES_ORDER_SRV`, `API_OUTBOUND_DELIVERY_SRV`, `API_MATERIAL_STOCK_SRV`, `API_INSPECTIONLOT_SRV`, `API_MATERIAL_DOCUMENT_SRV`, `API_SUPPLIERINVOICE_PROCESS_SRV`).
- Entity, field and protocol conventions follow SAP's, so pointing the connector at a real system is a configuration change.
- Fields prefixed `YY1_` are custom extension fields, as a customer would add them through SAP key-user extensibility.
- Only the fields below are implemented. Anything else is ignored on write and absent on read.

## Protocol
| Aspect | Contract |
|---|---|
| Base URL | `http://localhost:4004/sap/opu/odata/sap/<SERVICE>/` |
| Auth | HTTP Basic. The mock accepts the credentials in its config (`MOCK_S4_USER` / `MOCK_S4_PASSWORD`) |
| Format | JSON (`Accept: application/json` or `$format=json`) |
| Collection response | `{"d": {"results": [...], "__count": "42", "__next": "<url with $skiptoken>"}}` |
| Single response | `{"d": {...}}` |
| `Edm.DateTime` | `"/Date(<ms since epoch>)/"` |
| `Edm.DateTimeOffset` | `"/Date(<ms since epoch>+0000)/"` |
| `Edm.Decimal` | Strings, e.g. `"4200.000"` |
| Query options | `$filter` (eq, ne, gt, ge, lt, le, and; `datetimeoffset'…'` literals), `$orderby`, `$top`, `$skip`, `$inlinecount=allpages`, `$select`. Server-driven paging at 500 rows via `__next` |
| CSRF | `GET` with `x-csrf-token: Fetch` returns `x-csrf-token: <token>` and a session cookie. `POST` / `PATCH` / `MERGE` without a valid token + cookie get `403` with `x-csrf-token: Required`. Tokens expire after 30 minutes |
| Concurrency | Entities carry `__metadata.etag` and an `ETag` header. `PATCH` / `MERGE` require `If-Match` and return `412 Precondition Failed` if the entity changed. **This is the dispatcher's compare-and-set** |
| Idempotency | Every write carries our idempotency reference in a reference field (listed per entity). Before retrying, the dispatcher **looks the reference up** with `$filter=<field> eq '<ref>'`. An existing match means "already applied" |
| Errors | `{"error": {"code": "...", "message": {"lang": "en", "value": "..."}}}` with HTTP 400 / 403 / 404 / 409 / 412 / 423 (locked) / 500. The mock can be told to fail on purpose (`/__mock/faults`) for failure-injection tests |
| Delta reads | `$filter=LastChangeDateTime gt datetimeoffset'<cursor>'&$orderby=LastChangeDateTime`. The connector stores the last `LastChangeDateTime` as its cursor in `RAW.CONNECTOR_STATE` |

## Entity sets
### `API_SALES_ORDER_SRV`
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_SalesOrder` | `SalesOrder` | `SoldToParty`, `SalesOrderDate`, `TransactionCurrency` (`USD`), `OverallSDProcessStatus`, `PurchaseOrderByCustomer`, `YY1_BBCReference`, `LastChangeDateTime` | GET (delta); **POST** deep insert with `to_Item` (re-route or processor sale, i.e. `SO_CREATE`); **POST** `/RejectSalesOrder?SalesOrder='…'` (`CANCEL_SO`) |
| `A_SalesOrderItem` | `SalesOrder`, `SalesOrderItem` | `Material`, `RequestedQuantity`, `RequestedQuantityUnit` (`KG`), `NetPriceAmount` (per `NetPriceQuantity` = 1 KG), `Batch`, `ShipToParty`, `RequestedDeliveryDate`, `SDProcessStatus`, `YY1_BBCReference`, `LastChangeDateTime` | GET (delta); **PATCH** `Batch` / `RequestedQuantity` / `RequestedDeliveryDate` with `If-Match` (`SO_CHANGE`, `SO_REVERT`) |

### `API_OUTBOUND_DELIVERY_SRV`
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_OutbDeliveryHeader` | `DeliveryDocument` | `ShipToParty`, `PlannedGoodsIssueDate`, `OverallGoodsMovementStatus`, `YY1_BBCReference`, `LastChangeDateTime` | GET (delta); **POST** deep insert with `to_DeliveryDocumentItem` (`REPLACEMENT_ALLOCATION`); **DELETE** before goods issue (`DEALLOCATE`) |
| `A_OutbDeliveryItem` | `DeliveryDocument`, `DeliveryDocumentItem` | `ReferenceSDDocument`, `ReferenceSDDocumentItem`, `Material`, `Batch`, `ActualDeliveryQuantity`, `DeliveryQuantityUnit` | GET |

### `API_MATERIAL_STOCK_SRV`
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_MatlStkInAcctMod` | `Material`, `Plant`, `StorageLocation`, `Batch`, `InventoryStockType` | `MatlWrhsStkQtyInMatlBaseUnit`, `MaterialBaseUnit` (`KG`) | GET (full snapshot read; the connector stamps `snapshot_at`) |

`InventoryStockType` maps to our `stock_status`: `01` → `UNRESTRICTED`, `02` → `QUALITY`, `07` → `BLOCKED`, `06` → `IN_TRANSIT`. Our `ALLOCATED` is derived from open deliveries.

### `API_INSPECTIONLOT_SRV`
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_InspectionLot` | `InspectionLot` | `Material`, `Batch`, `Plant`, `InspectionLotType` (`01` goods receipt → `RECEIPT`, `04` in-process → `INTERMEDIATE`, `89` origin → `ORIGIN`), `InspLotCreatedOnLocalDate`, `InspectionLotUsageDecisionCode` (`A` accept, `R` reject), `YY1_PulpTempC`, `YY1_DefectsPct`, `YY1_DecayPct`, `YY1_RemainingSLDays`, `YY1_InspectorName`, `LastChangeDateTime` | GET (delta) |

### `API_MATERIAL_DOCUMENT_SRV`
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_MaterialDocumentHeader` | `MaterialDocument`, `MaterialDocumentYear` | `PostingDate`, `GoodsMovementCode`, `MaterialDocumentHeaderText` (= our idempotency reference), `to_MaterialDocumentItem` | **POST** deep insert; GET with `$filter=MaterialDocumentHeaderText eq '<ref>'` |
| `A_MaterialDocumentItem` | (as header) + `MaterialDocumentItem` | `Material`, `Plant`, `StorageLocation`, `Batch`, `GoodsMovementType` (**`344`** unrestricted → blocked = `STOCK_BLOCK`; **`343`** blocked → unrestricted = `STOCK_UNBLOCK`), `QuantityInEntryUnit`, `EntryUnit` | (via header) |

### `API_SUPPLIERINVOICE_PROCESS_SRV` (simplified)
| Entity set | Key | Fields used | Operations |
|---|---|---|---|
| `A_SupplierInvoice` | `SupplierInvoice`, `FiscalYear` | `InvoicingParty` (grower), `DocumentDate`, `PostingDate`, `InvoiceGrossAmount`, `DocumentCurrency` (`USD`), `IsInvoice` (`false` = credit memo, i.e. a **grower deduction**), `SupplierInvoiceIDByInvcgParty` (= our reference), `DocumentHeaderText`, `YY1_CaseId` | **POST** (`GROWER_DEDUCTION`); **POST** `/Cancel?SupplierInvoice='…'&FiscalYear='…'` (`REVERSAL_POSTING`); GET by reference |

**`ABSORB` (write-off)** is recorded internally and, if configured, posted as a supplier credit memo against the company's own loss account. Real deployments would use journal-entry posting, which is out of scope for the mock.

## Mapping to RAW (inbound)
| Entity | `entity_type` | `external_id` | `event_ts` |
|---|---|---|---|
| `A_SalesOrderItem` | `SALES_ORDER_ITEM` | `<SalesOrder>-<SalesOrderItem>` | `LastChangeDateTime` |
| `A_OutbDeliveryItem` (+ header) | `DELIVERY` | `<DeliveryDocument>-<Item>` | header `LastChangeDateTime` |
| `A_MatlStkInAcctMod` | `STOCK_SNAPSHOT` | `<Plant>-<Batch>-<StockType>` | `snapshot_at` (read time) |
| `A_InspectionLot` | `INSPECTION_RESULT` | `InspectionLot` | `LastChangeDateTime` |

Material ↔ `product_id`, Plant ↔ `site_id`, Batch ↔ `lot_id`, and business partner ↔ `party_id` come from the world config's key mapping (`sim/world.yaml` → `REF`).
