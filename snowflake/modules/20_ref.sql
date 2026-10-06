-- =============================================================================
-- BlueberryChain OS - WP2: versioned reference data
-- Contracts: contracts/schemas/reference/*.json (column order = schema order, as
-- bbc_toolkit.reference.insert_sql expects). Written only by
-- API.APPLY_REFERENCE_CHANGE: content rows are append-only; the superseded
-- version's is_current / valid_to are the only values ever updated.
-- =============================================================================
USE ROLE BBC_OWNER;
USE SCHEMA BBC_OS.REF;

CREATE TABLE IF NOT EXISTS PARTIES (
  party_id STRING NOT NULL, party_type STRING NOT NULL, name STRING NOT NULL, customer_tier STRING,
  sap_business_partner STRING, account_notes STRING,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Companies: own company, growers, carriers, customers, processors.';

CREATE TABLE IF NOT EXISTS SITES (
  site_id STRING NOT NULL, party_id STRING NOT NULL, site_type STRING NOT NULL, name STRING NOT NULL,
  city STRING, state STRING, lat FLOAT NOT NULL, lon FLOAT NOT NULL, sap_plant STRING,
  dock_capacity_kg_per_day NUMBER(14,3),
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Ranch blocks, packhouse, DCs, customer DCs, processor, route junctions.';

CREATE TABLE IF NOT EXISTS LANES (
  lane_id STRING NOT NULL, origin_site_id STRING NOT NULL, dest_site_id STRING NOT NULL, mode STRING NOT NULL,
  transit_h_p50 NUMBER(8,2) NOT NULL, transit_h_p90 NUMBER(8,2) NOT NULL, distance_mi NUMBER(10,1) NOT NULL,
  cost_per_load_usd NUMBER(14,2) NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Site-to-site lanes: transit distribution (p50/p90) and cost per load.';

CREATE TABLE IF NOT EXISTS PRODUCTS (
  product_id STRING NOT NULL, variety STRING NOT NULL, pack STRING NOT NULL, organic BOOLEAN NOT NULL,
  sap_material STRING, ref_shelf_life_days NUMBER(6,2) NOT NULL, tref_c NUMBER(5,2) NOT NULL, q10 NUMBER(6,3) NOT NULL,
  threshold_c NUMBER(5,2) NOT NULL, tolerance_min NUMBER(6,0) NOT NULL, unmonitored_assumed_temp_c NUMBER(5,2) NOT NULL,
  validity_min_temp_c NUMBER(5,2) NOT NULL, validity_max_temp_c NUMBER(5,2) NOT NULL, prior_sigma_days NUMBER(5,2) NOT NULL,
  kg_per_pallet NUMBER(14,3),
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Products and their shelf-life model parameters (decisions record the version they used).';

CREATE TABLE IF NOT EXISTS CUSTOMER_SPECS (
  customer_party_id STRING NOT NULL, product_id STRING NOT NULL, min_shelf_life_days_at_receipt NUMBER(6,2) NOT NULL,
  max_arrival_pulp_c NUMBER(5,2), organic_required BOOLEAN NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'What each customer requires at receipt, per product.';

CREATE TABLE IF NOT EXISTS CONTRACTS (
  contract_id STRING NOT NULL, party_id STRING NOT NULL, contract_type STRING NOT NULL, terms VARIANT NOT NULL,
  clause_text STRING NOT NULL, source_doc_id STRING, effective_from DATE NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Carrier, grower and customer contracts: structured terms plus clause text.';

CREATE TABLE IF NOT EXISTS CHANNEL_PRICES (
  product_id STRING NOT NULL, channel STRING NOT NULL, price_usd_per_kg NUMBER(10,4) NOT NULL, effective_from DATE NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Price per kg by sales channel.';

CREATE TABLE IF NOT EXISTS SENSORS (
  device_id STRING NOT NULL, device_type STRING NOT NULL, owner_party_id STRING NOT NULL, placement STRING NOT NULL,
  calibrated_on DATE, accuracy_c NUMBER(4,2) NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Measuring devices and how far their readings can be trusted.';

CREATE TABLE IF NOT EXISTS COST_RATES (
  cost_rate_id STRING NOT NULL, cost_type STRING NOT NULL, scope_type STRING NOT NULL, scope_id STRING,
  rate NUMBER(14,4) NOT NULL, unit STRING NOT NULL,
  version NUMBER(10,0) NOT NULL, valid_from TIMESTAMP_TZ NOT NULL, valid_to TIMESTAMP_TZ, is_current BOOLEAN NOT NULL,
  changed_by STRING NOT NULL, change_reason STRING NOT NULL, record_hash STRING NOT NULL, batch_id STRING NOT NULL
) COMMENT = 'Costs the evaluation engine prices options with.';
