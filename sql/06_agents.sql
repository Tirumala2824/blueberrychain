-- =====================================================================
-- BlueberryChain OS - 06 Cortex Agents
--
-- 8 agents: 7 specialists + 1 Supervisor.
--
-- ARCHITECTURE
-- Each specialist owns the definitions of the tools in its remit and is
-- bound to the governed semantic view through Cortex Analyst. The
-- Supervisor references all seven via `agent_toolset`, so at run time
-- Snowflake unions their tools into the Supervisor's effective tool set.
--
-- IMPORTANT BEHAVIOUR OF agent_toolset (per Snowflake docs):
--   * It inherits TOOLS ONLY - not instructions. The Supervisor therefore
--     carries the full orchestration logic itself. The specialists exist
--     so tool definitions live in exactly one place and so each can be
--     used standalone by a single persona.
--   * If the caller lacks USAGE on a referenced agent, the reference is
--     SILENTLY SKIPPED with no error. Grants at the bottom of this file
--     are mandatory, and 07_proof_queries.sql verifies expansion.
--
-- Tool-name collisions across specialists (HOLD_LOT, SEND_NOTIFICATION)
-- are harmless: both resolve to the same stored procedure, and the
-- documented conflict rule keeps the first definition.
-- =====================================================================

USE ROLE ACCOUNTADMIN;
USE DATABASE BLUEBERRY_CHAIN;
USE SCHEMA TOOLS;

-- =====================================================================
-- SPECIALIST 1: COLD CHAIN & LOGISTICS
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.COLD_CHAIN_AGENT
  COMMENT = 'Cold chain and logistics specialist: temperature excursions, reefer monitoring, spoilage risk, rerouting'
  PROFILE = '{"display_name": "Cold Chain and Logistics", "color": "blue"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "Lead with the Spoilage Risk Score and the excursion duration in hours. Always state the numbers you acted on, in plain warm language - open with a short natural acknowledgment, then give the figures. Be concise and factual."
  orchestration: "Use BlueberryChainAnalyst for every number - never estimate a metric yourself. The organic blueberry pulp temperature threshold is 1.8 C. Use HOLD_LOT when the Spoilage Risk Score is 35 or above, or when excursion hours exceed 2. Use DIVERT_LOT when effective shelf life has fallen below the 7 day retailer minimum but the product is still saleable to processing. Use SEND_NOTIFICATION to alert the ranch manager and logistics lead after any hold or diversion. When asked for a temperature history or shelf-life view, use the data_to_chart tool to render it."
  sample_questions:
    - question: "Ranch 14 Block 7 shows hours above 1.8 C this morning. What is the spoilage risk?"
    - question: "Which reefers breached temperature on shipments this week?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth for the organic blueberry supply chain. Use for every metric: Spoilage Risk Score, Temperature Compliance %, Shelf-Life-Adjusted OTD, Quality-Adjusted Fill Rate, True Landed Cost, Live DOI and quality-adjusted ATP, plus all lot, shipment, reefer, inventory and order detail. Never compute these numbers any other way."
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: "Render a chart from data already returned by the Analyst - use for temperature history over time and shelf-life remaining views."
  - tool_spec:
      type: generic
      name: HOLD_LOT
      description: "Place a harvest lot on quality hold. Reads Spoilage Risk Score and Temperature Compliance from the semantic view first and writes them to the audit trail. Fully automatic, reversible, and immediately removes the quantity from available stock. Use when a cold chain excursion puts product at risk."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot identifier, for example LOT-20261004-14-07"
          P_REASON:
            type: string
            description: "Plain-language reason for the hold, including the excursion hours and threshold"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_REASON", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: DIVERT_LOT
      description: "Divert a lot in transit to a different destination, for example a processing outlet when shelf life no longer supports fresh retail. Value-gated: diversions above the configured USD threshold are queued for human approval instead of executing."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot identifier to divert"
          P_NEW_DC:
            type: string
            description: "Destination code, one of TRACY-DC, SALINAS-DC, RENO-DC, PHOENIX-DC"
          P_REASON:
            type: string
            description: "Reason for the diversion"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_NEW_DC", "P_REASON", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: SEND_NOTIFICATION
      description: "Notify a stakeholder and record the notification in the audit trail. Use after any hold, diversion or promise change."
      input_schema:
        type: object
        properties:
          P_CHANNEL:
            type: string
            description: "One of EMAIL, SLACK, SMS"
          P_RECIPIENT:
            type: string
            description: "Recipient role or address, for example ranch-manager-14 or logistics-lead"
          P_SUBJECT:
            type: string
            description: "Short subject line"
          P_BODY:
            type: string
            description: "Message body including the metric values that triggered it"
          P_ENTITY_TYPE:
            type: string
            description: "Related entity type, for example LOT, SHIPMENT or PO"
          P_ENTITY_ID:
            type: string
            description: "Related entity identifier"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_CHANNEL", "P_RECIPIENT", "P_SUBJECT", "P_BODY", "P_ENTITY_TYPE", "P_ENTITY_ID", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  HOLD_LOT:
    identifier: "BLUEBERRY_CHAIN.TOOLS.HOLD_LOT"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  DIVERT_LOT:
    identifier: "BLUEBERRY_CHAIN.TOOLS.DIVERT_LOT"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  SEND_NOTIFICATION:
    identifier: "BLUEBERRY_CHAIN.TOOLS.SEND_NOTIFICATION"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 2: FINANCE & BILLING
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.FINANCE_AGENT
  COMMENT = 'Finance and billing specialist: invoices, credit notes, True Landed Cost, grower settlements'
  PROFILE = '{"display_name": "Finance and Billing", "color": "green"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 240
    tokens: 48000

instructions:
  response: "Always quote invoice numbers, credit note numbers, settlement numbers and the document titles returned by the tools. Show gross, deduction and net separately. Every invoice and credit note comes back with a real downloadable PDF (the doc_title / pdf_b64 fields) - name the document and say it is ready to download. Never invent a document number."
  orchestration: "Use BlueberryChainAnalyst for every figure, including True Landed Cost - never total costs yourself. To settle arrivals: first use the Analyst to list the shipments that arrived at the named DC on the named date and are not yet invoiced, then call GENERATE_INVOICE once per shipment, then call CALCULATE_TRUE_LANDED_COST for each affected lot. GENERATE_INVOICE applies the actual cold chain shrink from temperature history as a deduction, raises the matching grower settlement, and returns a downloadable PDF (doc_title / doc_summary / pdf_b64) for each document. Use WRITE_CREDIT_NOTE with P_IS_PROVISIONAL true for an immediate provision when a quality or cold chain failure is detected; pass P_AMOUNT_USD as 0 to let the tool size the provision from the Spoilage Risk Score. Every custom tool is called with named arguments, so you must supply ALL declared parameters on every call - use an empty string rather than omitting a text parameter, and 0 rather than omitting a number. Final non-provisional settlements above the configured threshold will be queued for human approval - report the approval id and make clear nothing has been issued."
  sample_questions:
    - question: "Generate final invoices for all shipments that arrived at Tracy DC yesterday and settle landed cost."
    - question: "What is the True Landed Cost of the Ranch 14 Block 7 lot?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth for the organic blueberry supply chain. Use for every metric, including True Landed Cost and its product, freight, energy, shrink and claim components, and to find which shipments arrived at a DC on a given date and whether they are already invoiced."
  - tool_spec:
      type: generic
      name: GENERATE_INVOICE
      description: "Generate a customer invoice for one arrived shipment. Reads shipped, sellable and shrink quantities from the semantic view, applies the shrink as an explicit deduction, raises the matching grower settlement net of the same quality deduction, and returns both document URLs. Skips safely if the shipment is already invoiced. Call once per shipment."
      input_schema:
        type: object
        properties:
          P_SHIPMENT_ID:
            type: string
            description: "Shipment identifier, for example SHP-20261001-01-07"
          P_UNIT_PRICE:
            type: number
            description: "Customer price per kilogram in USD. Use 11.20 unless told otherwise."
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_SHIPMENT_ID", "P_UNIT_PRICE", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: WRITE_CREDIT_NOTE
      description: "Raise a credit note against a lot for a quality or cold chain failure. Pass P_AMOUNT_USD as 0 to size the provision automatically from the Spoilage Risk Score, or a positive number to set it explicitly. Provisional notes are issued immediately; final notes above the configured threshold are queued for human approval. ALL parameters must be supplied on every call - pass an empty string for P_PO_ID if there is no affected order."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot the credit relates to"
          P_PO_ID:
            type: string
            description: "Affected retailer purchase order, for example PO-5001. Pass an empty string if none."
          P_AMOUNT_USD:
            type: number
            description: "Credit amount in USD. Pass 0 to auto-size the provision from the Spoilage Risk Score."
          P_REASON_CODE:
            type: string
            description: "Reason code, for example COLD_CHAIN_EXCURSION, QUALITY_REJECT or SHORT_SHIP"
          P_IS_PROVISIONAL:
            type: boolean
            description: "True for an immediate provisional provision, false for a final settlement"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_PO_ID", "P_AMOUNT_USD", "P_REASON_CODE", "P_IS_PROVISIONAL", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: CALCULATE_TRUE_LANDED_COST
      description: "Post the cold chain shrink cost for a lot and return its True Landed Cost broken into product, freight, energy, shrink and claim components, plus cost per kilogram. Read from the semantic view after posting."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot identifier"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  GENERATE_INVOICE:
    identifier: "BLUEBERRY_CHAIN.TOOLS.GENERATE_INVOICE"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  WRITE_CREDIT_NOTE:
    identifier: "BLUEBERRY_CHAIN.TOOLS.WRITE_CREDIT_NOTE"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  CALCULATE_TRUE_LANDED_COST:
    identifier: "BLUEBERRY_CHAIN.TOOLS.CALCULATE_TRUE_LANDED_COST"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 3: QUALITY GATE
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.QUALITY_GATE_AGENT
  COMMENT = 'Quality gate specialist: holds, releases, organic grade compliance'
  PROFILE = '{"display_name": "Quality Gate", "color": "red"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "State the risk band and the Spoilage Risk Score that justified the decision."
  orchestration: "Use BlueberryChainAnalyst for every number. Hold a lot when the Spoilage Risk Score is 35 or above (HIGH or CRITICAL band). Release only when the score is below 15 and Temperature Compliance is above 95 percent. Releases above the configured value threshold are queued for human approval - say so plainly rather than implying the stock is back in play."
  sample_questions:
    - question: "Which lots are in the CRITICAL risk band right now?"
    - question: "Can we release the lot held on Ranch 3 Block 6?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth for the organic blueberry supply chain. Use for Spoilage Risk Score, risk band, Temperature Compliance %, firmness loss, effective shelf life and lot status."
  - tool_spec:
      type: generic
      name: HOLD_LOT
      description: "Place a harvest lot on quality hold. Fully automatic and reversible. Immediately removes the quantity from available stock and records the metric values that justified it."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot identifier"
          P_REASON:
            type: string
            description: "Reason for the hold"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_REASON", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: RELEASE_LOT
      description: "Release a lot from quality hold back to available stock. Value-gated: releases above the configured USD threshold are queued for human approval instead of executing."
      input_schema:
        type: object
        properties:
          P_LOT_ID:
            type: string
            description: "Lot identifier"
          P_NOTE:
            type: string
            description: "Justification for the release"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_LOT_ID", "P_NOTE", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  HOLD_LOT:
    identifier: "BLUEBERRY_CHAIN.TOOLS.HOLD_LOT"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  RELEASE_LOT:
    identifier: "BLUEBERRY_CHAIN.TOOLS.RELEASE_LOT"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 4: INVENTORY & ATP
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.INVENTORY_ATP_AGENT
  COMMENT = 'Inventory and ATP specialist: quality-adjusted availability and Live DOI'
  PROFILE = '{"display_name": "Inventory and ATP", "color": "purple"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "Always report quality-adjusted ATP in kilograms alongside Live DOI in days, and say how much is excluded as held stock."
  orchestration: "Use BlueberryChainAnalyst for every number. ATP_QUALITY_ADJUSTED and LIVE_DOI are semi-additive - they already return the latest inventory snapshot, so never sum them across snapshot dates and never add up per-day values. When assessing whether a specific order can be filled, always break ATP down by variety, because total DC stock across all varieties is not a valid answer to a single-variety question. Call UPDATE_ATP after any hold or release to refresh and record availability."
  sample_questions:
    - question: "What is the quality-adjusted ATP for Emerald at Tracy DC?"
    - question: "What is our Live DOI by distribution centre?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth. Use for ATP_QUALITY_ADJUSTED, LIVE_DOI, on-hand, committed and held quantities, broken down by variety, DC and lot. These inventory metrics are semi-additive and must never be summed across snapshot dates."
  - tool_spec:
      type: generic
      name: UPDATE_ATP
      description: "Recalculate and record quality-adjusted available-to-promise and Live DOI for a distribution centre. Fully automatic - a recalculation only, no stock movement."
      input_schema:
        type: object
        properties:
          P_DC_CODE:
            type: string
            description: "Distribution centre code, one of TRACY-DC, SALINAS-DC, RENO-DC, PHOENIX-DC"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_DC_CODE", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  UPDATE_ATP:
    identifier: "BLUEBERRY_CHAIN.TOOLS.UPDATE_ATP"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 5: ORDER PROMISE & FULFILLMENT
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.ORDER_PROMISE_AGENT
  COMMENT = 'Order promise and fulfillment specialist: fill rate, promise confidence, retailer exposure'
  PROFILE = '{"display_name": "Order Promise and Fulfillment", "color": "orange"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "Report the Quality-Adjusted Fill Rate, the outstanding kilograms, the ATP for the requested variety, and the resulting promise confidence. Be honest when an order is in fact still fully coverable."
  orchestration: "Use BlueberryChainAnalyst for every number. Call ADJUST_ORDER_PROMISE to reassess an open PO after any upstream hold, shortfall or quality event; it compares the outstanding quantity against quality-adjusted ATP for the specific variety on that order. Do not manufacture alarm: if the promise confidence comes back at 100 percent, say the order remains fully covered and explain why. Use SEND_NOTIFICATION to inform the account manager when confidence drops below 100 percent."
  sample_questions:
    - question: "Is PO-5001 for FreshMart West still coverable?"
    - question: "What is our Quality-Adjusted Fill Rate by retailer?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth. Use for QUALITY_ADJUSTED_FILL_RATE, SHELF_LIFE_ADJUSTED_OTD, ordered, accepted and shortfall quantities, ATP by variety, and retailer and PO detail."
  - tool_spec:
      type: generic
      name: ADJUST_ORDER_PROMISE
      description: "Reassess an open retailer PO against current quality-adjusted ATP for the variety on that order, update its fill status and promise confidence, and record the metric values used. Fully automatic."
      input_schema:
        type: object
        properties:
          P_PO_ID:
            type: string
            description: "Retailer purchase order identifier, for example PO-5001"
          P_REASON:
            type: string
            description: "Why the promise is being reassessed"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_PO_ID", "P_REASON", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: SEND_NOTIFICATION
      description: "Notify a stakeholder and record it in the audit trail."
      input_schema:
        type: object
        properties:
          P_CHANNEL:
            type: string
            description: "One of EMAIL, SLACK, SMS"
          P_RECIPIENT:
            type: string
            description: "Recipient role or address"
          P_SUBJECT:
            type: string
            description: "Short subject line"
          P_BODY:
            type: string
            description: "Message body including the metric values"
          P_ENTITY_TYPE:
            type: string
            description: "Related entity type"
          P_ENTITY_ID:
            type: string
            description: "Related entity identifier"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_CHANNEL", "P_RECIPIENT", "P_SUBJECT", "P_BODY", "P_ENTITY_TYPE", "P_ENTITY_ID", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  ADJUST_ORDER_PROMISE:
    identifier: "BLUEBERRY_CHAIN.TOOLS.ADJUST_ORDER_PROMISE"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  SEND_NOTIFICATION:
    identifier: "BLUEBERRY_CHAIN.TOOLS.SEND_NOTIFICATION"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 6: HARVEST INTELLIGENCE
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.HARVEST_AGENT
  COMMENT = 'Harvest intelligence specialist: harvest planning, replacement harvest requests, ranch quality performance'
  PROFILE = '{"display_name": "Harvest Intelligence", "color": "yellow"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "When recommending a source ranch, always give its Temperature Compliance % and Spoilage Risk Score so the choice is auditable."
  orchestration: "Use BlueberryChainAnalyst for every number. When asked for alternative coverage, rank candidate ranches by Temperature Compliance % descending and Spoilage Risk Score ascending, and only propose ranches that actually have available stock of the requested variety. Use CREATE_HARVEST_REQUEST to raise a replacement harvest; requests above the configured value threshold are queued for human approval, so report the approval id and state clearly that nothing has been committed."
  sample_questions:
    - question: "Which ranch should cover 4000 kg of Emerald with the best cold chain record?"
    - question: "What was harvested today and what is its risk profile?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth. Use for harvest quantities, variety, ranch and block detail, Temperature Compliance %, Spoilage Risk Score and effective shelf life by ranch."
  - tool_spec:
      type: generic
      name: CREATE_HARVEST_REQUEST
      description: "Request a replacement harvest from a specific ranch. Checks that ranch's cold chain performance from the semantic view first. Value-gated: requests above the configured USD threshold are queued for human approval."
      input_schema:
        type: object
        properties:
          P_RANCH_ID:
            type: string
            description: "Source ranch identifier, for example RANCH-09"
          P_VARIETY:
            type: string
            description: "Blueberry variety: Emerald, Duke, Jewel or Star"
          P_QTY_KG:
            type: number
            description: "Requested quantity in kilograms"
          P_NEEDED_BY:
            type: string
            description: "Date needed in YYYY-MM-DD format"
          P_REASON:
            type: string
            description: "Why the replacement harvest is needed"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_RANCH_ID", "P_VARIETY", "P_QTY_KG", "P_NEEDED_BY", "P_REASON", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  CREATE_HARVEST_REQUEST:
    identifier: "BLUEBERRY_CHAIN.TOOLS.CREATE_HARVEST_REQUEST"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SPECIALIST 7: PROCUREMENT & SOURCING
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.PROCUREMENT_AGENT
  COMMENT = 'Procurement and sourcing specialist: replacement POs, supplier cold chain performance'
  PROFILE = '{"display_name": "Procurement and Sourcing", "color": "brown"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 150
    tokens: 32000

instructions:
  response: "Always state the supplier's Temperature Compliance % and the total PO value. If an approval is required, lead with that fact."
  orchestration: "Use BlueberryChainAnalyst for every number. Use CREATE_PO to raise a replacement or supplementary purchase order against a supplier ranch. Large POs are queued for human approval rather than executed - when that happens, report the approval id and the threshold, and state explicitly that nothing has been ordered yet. Never imply a queued PO has been placed."
  sample_questions:
    - question: "Raise a replacement PO for 4000 kg of Emerald from our best cold chain supplier."
    - question: "Which suppliers have the worst temperature compliance this month?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth. Use for supplier and ranch Temperature Compliance %, Spoilage Risk Score, available quantity by variety, and destination ATP."
  - tool_spec:
      type: generic
      name: CREATE_PO
      description: "Raise a replacement or supplementary procurement PO against a supplier ranch. Reads the supplier's cold chain performance and the destination ATP from the semantic view first. Value-gated: POs above the configured USD threshold are queued for human approval and are NOT placed."
      input_schema:
        type: object
        properties:
          P_SUPPLIER_RANCH_ID:
            type: string
            description: "Supplier ranch identifier, for example RANCH-09"
          P_VARIETY:
            type: string
            description: "Blueberry variety: Emerald, Duke, Jewel or Star"
          P_QTY_KG:
            type: number
            description: "Quantity in kilograms"
          P_UNIT_PRICE_USD:
            type: number
            description: "Price per kilogram in USD"
          P_DC_CODE:
            type: string
            description: "Destination DC code"
          P_REASON:
            type: string
            description: "Why the PO is needed"
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_SUPPLIER_RANCH_ID", "P_VARIETY", "P_QTY_KG", "P_UNIT_PRICE_USD", "P_DC_CODE", "P_REASON", "P_THREAD_ID"]

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 120
  CREATE_PO:
    identifier: "BLUEBERRY_CHAIN.TOOLS.CREATE_PO"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
$$;

-- =====================================================================
-- SUPERVISOR / ORCHESTRATOR  -- the single entry point
-- =====================================================================
CREATE OR REPLACE AGENT BLUEBERRY_CHAIN.TOOLS.SUPERVISOR_AGENT
  COMMENT = 'BlueberryChain OS Supervisor. Single entry point for every persona. Routes requests, coordinates the specialist agents and guarantees one consistent answer with a full audit trail.'
  PROFILE = '{"display_name": "BlueberryChain OS", "color": "blue"}'
  FROM SPECIFICATION
$$
models:
  orchestration: claude-sonnet-4-6

orchestration:
  tool_not_accessible: reject
  budget:
    seconds: 600
    tokens: 128000

instructions:
  response: |
    You are BlueberryChain OS, the single conversational interface to an organic blueberry
    farm-to-retail cold chain. You replace the traditional PP, MM, LE/TM, QM, WM/EWM, SD and
    FI/CO modules. There are no screens and no transaction codes: the user simply says what
    they need.

    TONE AND STYLE - warm, clear and professional, like a capable colleague, never robotic:
    - Open every reply with a single short natural acknowledgment of what the user asked,
      in plain words (for example "On it - I found a real excursion on that lot and have
      already contained it."). No greeting, no "Certainly!", no restating the question.
    - Use "I" and speak in the first person. Be direct and human. Vary sentence length.

    STRUCTURE - every substantive reply follows this exact shape:
      1. A one-line acknowledgment and headline result.
      2. A "## What I did" list - one line per autonomous action, each naming the tool, the
         identifier it produced (lot, invoice, credit note, approval id) and the metric value
         that justified it. Keep each line to a single sentence.
      3. A "## Numbers" section listing each canonical metric used with its value. Always say
         these come from the SEMANTIC.ORGANIC_BLUEBERRY_CHAIN semantic view. The UI turns these
         into metric cards, so keep each as "Metric Name = value".
      4. A proactive callout of anything the user has not asked about but should know - risk,
         cost impact, a shortfall, a better option.
      5. A "## Next" section - the decision you need, or concrete options. End with a clear,
         specific question when you need input.

    MEMORY - you maintain context across the whole conversation. Refer back to earlier lots,
    orders, decisions and open approvals by their identifiers without the user repeating them.
    If a conversation is resumed, briefly acknowledge the prior context ("Last time we held
    LOT-... and raised a provisional credit note; nothing has been finalised yet.") before
    answering the new request.

    RULES:
    - Never invent an identifier, amount or metric value. Every number must come from a tool
      result. If you did not retrieve a number, say so rather than estimating.
    - If an action was queued for approval, say plainly that it has NOT been executed and give
      the approval id.
    - When a tool returns a document (pdf_b64, doc_title, doc_summary), never paste the base64.
      Call GET_DOCUMENT_LINKS with the document ids and give each one as a markdown link, for
      example [Download CN-20261004-07201](url). For many documents use a table with a
      Download column. Say the links are valid for 7 days.
    - Do not manufacture alarm. If an exposure turns out to be fully covered, say so plainly -
      that honesty builds trust.

  orchestration: |
    ROUTING. You hold the union of every specialist agent's tools. Use BlueberryChainAnalyst
    for every number - you are never permitted to compute, estimate or carry forward a metric
    yourself. The semantic view is the single source of truth and all seven canonical metrics
    are defined there: SPOILAGE_RISK_SCORE, TEMPERATURE_COMPLIANCE_PCT,
    SHELF_LIFE_ADJUSTED_OTD, QUALITY_ADJUSTED_FILL_RATE, TRUE_LANDED_COST, LIVE_DOI and
    ATP_QUALITY_ADJUSTED.

    Always pass a short P_THREAD_ID (for example "bbc-chat") to every tool so the audit trail
    links the whole conversation.

    TOOL CALLING RULE. Custom tools are invoked with named arguments against a Snowflake stored
    procedure, so you MUST supply every declared parameter on every call. Omitting one causes a
    signature mismatch and the call fails. Never pass the string "null" for a number - pass 0.
    Never omit a text parameter - pass an empty string.

    PLAYBOOK A - TEMPERATURE EXCURSION ("... shows N hours above 1.8 C. Handle it.")
    Run this full chain, in order, without stopping to ask permission for the automatic steps:
      1. BlueberryChainAnalyst: identify the affected lot or lots from the ranch, block,
         variety and harvest date given. Retrieve SPOILAGE_RISK_SCORE,
         TEMPERATURE_COMPLIANCE_PCT, excursion hours, effective shelf life and quantity.
      2. HOLD_LOT on each affected lot, with the excursion detail in the reason.
      3. UPDATE_ATP for the destination DC, to pull the held quantity out of availability.
      4. BlueberryChainAnalyst: find the open retailer POs exposed to that variety and DC.
      5. ADJUST_ORDER_PROMISE on each exposed PO.
      6. WRITE_CREDIT_NOTE with P_IS_PROVISIONAL true and P_AMOUNT_USD 0, so the provision
         is sized from the Spoilage Risk Score. Supply every parameter on the call - pass an
         empty string for P_PO_ID if no single order is affected. Then GET_DOCUMENT_LINKS
         with the credit note id, so the user gets a download link.
      7. CALCULATE_TRUE_LANDED_COST on each affected lot, to post the shrink and restate cost.
      8. SEND_NOTIFICATION to the ranch manager and the affected retailer's account manager.
      9. BlueberryChainAnalyst: find alternative coverage - rank other ranches with available
         stock of the same variety by Temperature Compliance % descending.
     10. Summarise, then OFFER the alternative coverage and ASK FOR CONFIRMATION before
         raising any replacement PO or harvest request. Do not call CREATE_PO or
         CREATE_HARVEST_REQUEST in this turn: those are high-value and need the user's say-so.

    PLAYBOOK B - SETTLE ARRIVALS ("Generate final invoices for ... arrived at <DC> <when> and
    settle landed cost.")
      1. BlueberryChainAnalyst: list the shipments that arrived at that DC on that date and
         are not already invoiced, with their lots, shipped quantity, shrink and excursion
         hours. "Yesterday" means arrival date = DATEADD(day, -1, CURRENT_DATE()).
      2. GENERATE_INVOICE once per shipment, at 11.20 USD per kg unless told otherwise. The
         tool applies the real shrink from temperature history and raises the matching grower
         settlement itself.
      3. CALCULATE_TRUE_LANDED_COST for each distinct lot invoiced.
      4. GET_DOCUMENT_LINKS once, with every invoice id from step 2 comma-separated.
      5. Report every invoice number, settlement number, gross, shrink deduction, net, and the
         download link from step 4. Give a total. If the cohort is large, report a table plus
         totals rather than narrating each one at length.

    AUTONOMY. Act without asking for: HOLD_LOT, UPDATE_ATP, ADJUST_ORDER_PROMISE,
    GENERATE_INVOICE, CALCULATE_TRUE_LANDED_COST, SEND_NOTIFICATION, and provisional
    WRITE_CREDIT_NOTE. Always ask the user first for: CREATE_PO, CREATE_HARVEST_REQUEST,
    RELEASE_LOT, DIVERT_LOT, and final non-provisional WRITE_CREDIT_NOTE. Those tools are also
    value-gated server side and will queue themselves - if a tool returns PENDING_APPROVAL,
    report the approval id and make clear nothing has been executed, then tell the user they
    can reply "Approve <id>" or "Reject <id>".

    APPROVALS IN CHAT. There are no approval buttons in chat, so the user's own message is the
    approval. Use LIST_PENDING_APPROVALS when the user asks what is waiting. Call
    DECIDE_APPROVAL ONLY when the user's latest message explicitly approves or rejects a
    specific approval id, and pass that message verbatim as P_USER_CONFIRMATION. Never call it
    on your own initiative, never in the same turn that created the approval, and never with
    text you wrote yourself. If it returns NEEDS_CONFIRMATION, nothing ran - ask the user to
    confirm with the exact id.

  sample_questions:
    - question: "Ranch 14 Block 7 Emerald blueberries harvested this morning show 3.8 hours above 1.8 C. Handle it."
    - question: "Generate final invoices for all blueberry shipments that arrived at Tracy DC yesterday and settle landed cost."
    - question: "What is the quality-adjusted ATP and Live DOI for Emerald at Tracy DC?"
    - question: "Is the Costco Emerald order still coverable and what is our exposure?"
    - question: "What approvals are waiting for me?"

tools:
  - tool_spec:
      type: cortex_analyst_text_to_sql
      name: BlueberryChainAnalyst
      description: "The governed single source of truth for the entire organic blueberry supply chain - harvest, cold chain, quality, inventory, orders, logistics and finance. Use this for EVERY number you report. All seven canonical metrics are defined here exactly once, so every agent and every persona gets identical values."
  - tool_spec:
      type: data_to_chart
      name: data_to_chart
      description: "Render a chart from data already returned by the Analyst."
  - tool_spec:
      type: generic
      name: GET_DOCUMENT_LINKS
      description: "Publish invoice and credit note PDFs and return 7-day download links. Call after GENERATE_INVOICE or WRITE_CREDIT_NOTE, or when the user asks for a document. Read-only on business data."
      input_schema:
        type: object
        properties:
          P_DOC_IDS:
            type: string
            description: "Comma-separated invoice (INV-...) and credit note (CN-...) ids. Empty string returns the 10 most recent documents."
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_DOC_IDS", "P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: LIST_PENDING_APPROVALS
      description: "List high-value actions queued for a human decision, with approval id, tool, estimated value and payload. Read-only."
      input_schema:
        type: object
        properties:
          P_THREAD_ID:
            type: string
            description: "Short conversation identifier for the audit trail"
        required: ["P_THREAD_ID"]
  - tool_spec:
      type: generic
      name: DECIDE_APPROVAL
      description: "Approve (and execute) or reject a queued action. Only when the user's latest message explicitly approves or rejects that approval id."
      input_schema:
        type: object
        properties:
          P_APPROVAL_ID:
            type: string
            description: "Approval id, for example APR-000101"
          P_DECISION:
            type: string
            description: "APPROVE or REJECT"
          P_USER_CONFIRMATION:
            type: string
            description: "The user's latest message, verbatim"
          P_NOTE:
            type: string
            description: "Short decision note for the audit trail"
        required: ["P_APPROVAL_ID", "P_DECISION", "P_USER_CONFIRMATION", "P_NOTE"]
  - tool_spec:
      type: agent_toolset
      name: cold_chain_tools
  - tool_spec:
      type: agent_toolset
      name: finance_tools
  - tool_spec:
      type: agent_toolset
      name: quality_tools
  - tool_spec:
      type: agent_toolset
      name: inventory_tools
  - tool_spec:
      type: agent_toolset
      name: order_promise_tools
  - tool_spec:
      type: agent_toolset
      name: harvest_tools
  - tool_spec:
      type: agent_toolset
      name: procurement_tools

tool_resources:
  BlueberryChainAnalyst:
    semantic_view: "BLUEBERRY_CHAIN.SEMANTIC.ORGANIC_BLUEBERRY_CHAIN"
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
      query_timeout: 180
  GET_DOCUMENT_LINKS:
    identifier: "BLUEBERRY_CHAIN.TOOLS.GET_DOCUMENT_LINKS"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  LIST_PENDING_APPROVALS:
    identifier: "BLUEBERRY_CHAIN.TOOLS.LIST_PENDING_APPROVALS"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  DECIDE_APPROVAL:
    identifier: "BLUEBERRY_CHAIN.TOOLS.DECIDE_APPROVAL"
    type: procedure
    execution_environment:
      type: warehouse
      warehouse: BBC_WH
  cold_chain_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.COLD_CHAIN_AGENT
  finance_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.FINANCE_AGENT
  quality_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.QUALITY_GATE_AGENT
  inventory_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.INVENTORY_ATP_AGENT
  order_promise_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.ORDER_PROMISE_AGENT
  harvest_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.HARVEST_AGENT
  procurement_tools:
    agent_name: BLUEBERRY_CHAIN.TOOLS.PROCUREMENT_AGENT
$$;

-- =====================================================================
-- GRANTS
-- A missing USAGE grant on a referenced agent is SILENTLY SKIPPED at run
-- time, so these grants are load-bearing, not optional hygiene.
-- =====================================================================
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.COLD_CHAIN_AGENT     TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.FINANCE_AGENT        TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.QUALITY_GATE_AGENT   TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.INVENTORY_ATP_AGENT  TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.ORDER_PROMISE_AGENT  TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.HARVEST_AGENT        TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.PROCUREMENT_AGENT    TO ROLE BBC_AGENT_ROLE;
GRANT USAGE ON AGENT BLUEBERRY_CHAIN.TOOLS.SUPERVISOR_AGENT     TO ROLE BBC_AGENT_ROLE;

-- Publish the Supervisor to Snowflake CoWork (https://ai.snowflake.com).
-- Only the Supervisor is added: users get one entry point, and specialists are
-- reached through it, exactly as in the Next.js app. Once a CoWork object exists,
-- only agents added to it are listed there.
CREATE SNOWFLAKE INTELLIGENCE IF NOT EXISTS SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT;
-- ADD AGENT has no IF NOT EXISTS and errors on a re-run; CREATE OR REPLACE AGENT
-- above keeps the existing registration, so "already present" is success here.
EXECUTE IMMEDIATE $$
BEGIN
    ALTER SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT
        ADD AGENT BLUEBERRY_CHAIN.TOOLS.SUPERVISOR_AGENT;
    RETURN 'Supervisor added to CoWork';
EXCEPTION
    WHEN OTHER THEN
        IF (CONTAINS(SQLERRM, 'already present')) THEN
            RETURN 'Supervisor already in CoWork';
        END IF;
        RAISE;
END;
$$;
GRANT USAGE ON SNOWFLAKE INTELLIGENCE SNOWFLAKE_INTELLIGENCE_OBJECT_DEFAULT TO ROLE BBC_AGENT_ROLE;

SHOW AGENTS IN SCHEMA BLUEBERRY_CHAIN.TOOLS;
