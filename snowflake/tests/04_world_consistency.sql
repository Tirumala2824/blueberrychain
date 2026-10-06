-- Day 4 checks: a simulated world (`bbc sim run`) landed through SAP, TMS and IoT
-- connectors and tells one consistent story across sources. Passes trivially on empty OPS.

-- test: every lot on a shipment is a known lot
SELECT sl.shipment_id, sl.lot_id FROM BBC_OS.OPS.SHIPMENT_LOTS sl
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOTS l WHERE l.lot_id = sl.lot_id);

-- test: every lot assigned to an order line is a known lot of the ordered product
SELECT o.order_line_id, o.assigned_lot_id, o.product_id, l.product_id AS lot_product
FROM BBC_OS.OPS.ORDER_LINES o
LEFT JOIN BBC_OS.OPS.LOTS l ON l.lot_id = o.assigned_lot_id
WHERE o.assigned_lot_id IS NOT NULL AND (l.lot_id IS NULL OR l.product_id <> o.product_id);

-- test: every delivery points at a known order line and lot
SELECT d.delivery_id FROM BBC_OS.OPS.DELIVERIES d
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.ORDER_LINES o WHERE o.order_line_id = d.order_line_id)
   OR NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOTS l WHERE l.lot_id = d.lot_id);

-- test: custody events name known shipments and known parties
SELECT c.event_id FROM BBC_OS.OPS.CUSTODY_EVENTS c
WHERE (c.shipment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.SHIPMENTS s WHERE s.shipment_id = c.shipment_id))
   OR NOT EXISTS (SELECT 1 FROM BBC_OS.REF.PARTIES p WHERE p.party_id = c.from_party_id AND p.is_current)
   OR NOT EXISTS (SELECT 1 FROM BBC_OS.REF.PARTIES p WHERE p.party_id = c.to_party_id AND p.is_current);

-- test: every device assignment pairs a known sensor with a known lot or shipment
SELECT a.assignment_id, a.device_id, a.target_type, a.target_id FROM BBC_OS.OPS.DEVICE_ASSIGNMENTS a
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.REF.SENSORS s WHERE s.device_id = a.device_id AND s.is_current)
   OR (a.target_type = 'LOT' AND NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOTS l WHERE l.lot_id = a.target_id))
   OR (a.target_type = 'SHIPMENT' AND NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.SHIPMENTS s WHERE s.shipment_id = a.target_id));

-- test: every lot has a PRIMARY probe from harvest on
SELECT l.lot_id FROM BBC_OS.OPS.LOTS l
WHERE NOT EXISTS (
  SELECT 1 FROM BBC_OS.OPS.DEVICE_ASSIGNMENTS a
  WHERE a.target_type = 'LOT' AND a.target_id = l.lot_id AND a.role = 'PRIMARY' AND a.assigned_from <= l.harvest_at);

-- test: every shipment that has left has its reefer unit paired from departure
SELECT s.shipment_id, s.status FROM BBC_OS.OPS.SHIPMENTS s
WHERE s.status NOT IN ('PLANNED', 'LOADING', 'CANCELLED')
  AND NOT EXISTS (
    SELECT 1 FROM BBC_OS.OPS.DEVICE_ASSIGNMENTS a
    WHERE a.target_type = 'SHIPMENT' AND a.target_id = s.shipment_id AND a.role = 'REEFER'
      AND a.device_id = s.reefer_device_id);

-- test: a delivered shipment was loaded to its carrier before it was unloaded
SELECT s.shipment_id FROM BBC_OS.OPS.SHIPMENTS s
WHERE s.status = 'DELIVERED'
  AND NOT EXISTS (
    SELECT 1 FROM BBC_OS.OPS.CUSTODY_EVENTS l
    JOIN BBC_OS.OPS.CUSTODY_EVENTS u ON u.shipment_id = l.shipment_id AND u.event_type = 'UNLOAD' AND u.at > l.at
    WHERE l.shipment_id = s.shipment_id AND l.event_type = 'LOAD' AND l.to_party_id = s.carrier_party_id);

-- test: stock is held for known lots at known sites
SELECT i.site_id, i.lot_id FROM BBC_OS.OPS.INVENTORY_SNAPSHOTS i
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOTS l WHERE l.lot_id = i.lot_id)
   OR NOT EXISTS (SELECT 1 FROM BBC_OS.REF.SITES s WHERE s.site_id = i.site_id AND s.is_current);

-- test: organic order lines are filled only with organic lots
SELECT o.order_line_id FROM BBC_OS.OPS.ORDER_LINES o
JOIN BBC_OS.REF.CUSTOMER_SPECS cs ON cs.customer_party_id = o.customer_party_id AND cs.product_id = o.product_id AND cs.is_current
JOIN BBC_OS.OPS.LOTS l ON l.lot_id = o.assigned_lot_id
WHERE cs.organic_required AND NOT l.organic;

-- test: every lot with readings has a thermal state
SELECT DISTINCT ta.lot_id FROM BBC_OS.OPS.TELEMETRY_ASSIGNED ta
WHERE NOT EXISTS (SELECT 1 FROM BBC_OS.OPS.LOT_THERMAL_STATE s WHERE s.lot_id = ta.lot_id);

-- test: no ingest was dead-lettered
SELECT connector_id, target, errors FROM BBC_OS.RAW.INGEST_ERRORS;
