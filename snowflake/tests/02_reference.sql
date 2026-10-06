-- WP2 reference-data checks (run after `bbc ref load`).

-- test: every reference entity has current rows
WITH c AS (
  SELECT 'PARTIES' AS t, COUNT_IF(is_current) AS n FROM BBC_OS.REF.PARTIES UNION ALL
  SELECT 'SITES', COUNT_IF(is_current) FROM BBC_OS.REF.SITES UNION ALL
  SELECT 'LANES', COUNT_IF(is_current) FROM BBC_OS.REF.LANES UNION ALL
  SELECT 'PRODUCTS', COUNT_IF(is_current) FROM BBC_OS.REF.PRODUCTS UNION ALL
  SELECT 'CUSTOMER_SPECS', COUNT_IF(is_current) FROM BBC_OS.REF.CUSTOMER_SPECS UNION ALL
  SELECT 'CONTRACTS', COUNT_IF(is_current) FROM BBC_OS.REF.CONTRACTS UNION ALL
  SELECT 'CHANNEL_PRICES', COUNT_IF(is_current) FROM BBC_OS.REF.CHANNEL_PRICES UNION ALL
  SELECT 'SENSORS', COUNT_IF(is_current) FROM BBC_OS.REF.SENSORS UNION ALL
  SELECT 'COST_RATES', COUNT_IF(is_current) FROM BBC_OS.REF.COST_RATES
)
SELECT t AS empty_table FROM c WHERE n = 0;

-- test: no key has more than one current version
SELECT 'PARTIES' AS t, party_id AS k FROM BBC_OS.REF.PARTIES WHERE is_current GROUP BY party_id HAVING COUNT(*) > 1
UNION ALL SELECT 'SITES', site_id FROM BBC_OS.REF.SITES WHERE is_current GROUP BY site_id HAVING COUNT(*) > 1
UNION ALL SELECT 'LANES', lane_id FROM BBC_OS.REF.LANES WHERE is_current GROUP BY lane_id HAVING COUNT(*) > 1
UNION ALL SELECT 'PRODUCTS', product_id FROM BBC_OS.REF.PRODUCTS WHERE is_current GROUP BY product_id HAVING COUNT(*) > 1
UNION ALL SELECT 'CUSTOMER_SPECS', customer_party_id || '/' || product_id FROM BBC_OS.REF.CUSTOMER_SPECS WHERE is_current GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL SELECT 'CONTRACTS', contract_id FROM BBC_OS.REF.CONTRACTS WHERE is_current GROUP BY contract_id HAVING COUNT(*) > 1
UNION ALL SELECT 'CHANNEL_PRICES', product_id || '/' || channel || '/' || effective_from FROM BBC_OS.REF.CHANNEL_PRICES WHERE is_current GROUP BY 2 HAVING COUNT(*) > 1
UNION ALL SELECT 'SENSORS', device_id FROM BBC_OS.REF.SENSORS WHERE is_current GROUP BY device_id HAVING COUNT(*) > 1
UNION ALL SELECT 'COST_RATES', cost_rate_id FROM BBC_OS.REF.COST_RATES WHERE is_current GROUP BY cost_rate_id HAVING COUNT(*) > 1;

-- test: superseded versions are closed and current versions are open
SELECT 'PARTIES' AS t, party_id AS k, version FROM BBC_OS.REF.PARTIES WHERE is_current = (valid_to IS NOT NULL)
UNION ALL SELECT 'CONTRACTS', contract_id, version FROM BBC_OS.REF.CONTRACTS WHERE is_current = (valid_to IS NOT NULL)
UNION ALL SELECT 'PRODUCTS', product_id, version FROM BBC_OS.REF.PRODUCTS WHERE is_current = (valid_to IS NOT NULL);

-- test: every reference batch is recorded in the ledger
WITH batches AS (
  SELECT DISTINCT batch_id FROM (
    SELECT batch_id FROM BBC_OS.REF.PARTIES UNION ALL SELECT batch_id FROM BBC_OS.REF.SITES UNION ALL
    SELECT batch_id FROM BBC_OS.REF.LANES UNION ALL SELECT batch_id FROM BBC_OS.REF.PRODUCTS UNION ALL
    SELECT batch_id FROM BBC_OS.REF.CUSTOMER_SPECS UNION ALL SELECT batch_id FROM BBC_OS.REF.CONTRACTS UNION ALL
    SELECT batch_id FROM BBC_OS.REF.CHANNEL_PRICES UNION ALL SELECT batch_id FROM BBC_OS.REF.SENSORS UNION ALL
    SELECT batch_id FROM BBC_OS.REF.COST_RATES)
)
SELECT b.batch_id AS unledgered_batch FROM batches b
WHERE NOT EXISTS (
  SELECT 1 FROM BBC_OS.LEDGER.ENTRIES e
  WHERE e.entry_type = 'REFERENCE_CHANGED' AND e.payload:batch_id::STRING = b.batch_id
);

-- test: current reference rows are referentially intact
WITH p AS (SELECT party_id, party_type FROM BBC_OS.REF.PARTIES WHERE is_current),
     s AS (SELECT site_id FROM BBC_OS.REF.SITES WHERE is_current),
     pr AS (SELECT product_id FROM BBC_OS.REF.PRODUCTS WHERE is_current)
SELECT 'SITE->PARTY' AS rel, site_id AS k FROM BBC_OS.REF.SITES WHERE is_current AND party_id NOT IN (SELECT party_id FROM p)
UNION ALL SELECT 'LANE->SITE', lane_id FROM BBC_OS.REF.LANES WHERE is_current
  AND (origin_site_id NOT IN (SELECT site_id FROM s) OR dest_site_id NOT IN (SELECT site_id FROM s))
UNION ALL SELECT 'SPEC->PRODUCT', customer_party_id FROM BBC_OS.REF.CUSTOMER_SPECS WHERE is_current AND product_id NOT IN (SELECT product_id FROM pr)
UNION ALL SELECT 'CONTRACT->PARTY', contract_id FROM BBC_OS.REF.CONTRACTS c WHERE is_current
  AND NOT EXISTS (SELECT 1 FROM p WHERE p.party_id = c.party_id
                  AND p.party_type = DECODE(c.contract_type, 'CARRIER_TRANSPORT', 'CARRIER', 'GROWER_SUPPLY', 'GROWER', 'CUSTOMER'))
UNION ALL SELECT 'SENSOR->PARTY', device_id FROM BBC_OS.REF.SENSORS WHERE is_current AND owner_party_id NOT IN (SELECT party_id FROM p);
