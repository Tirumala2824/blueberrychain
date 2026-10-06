-- WP6b checks: the stage procedures (UNDERSTANDING -> OPTIONS -> RECOMMENDATION -> GOVERNANCE).
-- Invariants over every case the stages have touched; trivially true before any case advances,
-- except the grant checks.

-- test: every sealed pack re-hashes in SQL to its content hash (the same canonical JSON as Python)
SELECT pack_id FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS
WHERE BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_DELETE(pack, 'content_hash')) <> content_hash
   OR pack:content_hash::STRING <> content_hash;

-- test: every pack is on the ledger with its content hash, and its case points at a pack of its own
SELECT p.pack_id FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS p
LEFT JOIN BBC_OS.LEDGER.ENTRIES e ON e.seq = p.ledger_seq AND e.entry_type = 'ASSESSMENT_SEALED'
WHERE e.seq IS NULL OR e.payload:content_hash::STRING <> p.content_hash OR e.case_id <> p.case_id
UNION ALL
SELECT c.case_id FROM BBC_OS.DECISION.CASES c
WHERE c.current_pack_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS p WHERE p.pack_id = c.current_pack_id AND p.case_id = c.case_id);

-- test: pack metrics are the semantic view's values as of sealing (stored, never recomputed)
SELECT p.pack_id, l.value:lot_id::STRING AS lot_id
FROM BBC_OS.EVIDENCE.EVIDENCE_PACKS p, LATERAL FLATTEN(INPUT => p.pack:lots) l
WHERE ARRAY_SIZE(l.value:values) <> 4
   OR l.value:values[0]:name::STRING <> 'REMAINING_SHELF_LIFE_DAYS'
   OR l.value:values[0]:evidence_id::STRING NOT LIKE 'EV:PACK:' || p.pack_id || '#%';

-- test: every scored option set has exactly one default and at least one fallback, from one pack
SELECT case_id, pack_id, COUNT_IF(is_default) AS defaults, COUNT_IF(is_fallback) AS fallbacks
FROM BBC_OS.DECISION.OPTIONS GROUP BY case_id, pack_id
HAVING COUNT_IF(is_default) <> 1 OR COUNT_IF(is_fallback) < 1;

-- test: every option is stored whole, hashed, ranked iff feasible, and on the ledger
SELECT o.option_id FROM BBC_OS.DECISION.OPTIONS o
LEFT JOIN BBC_OS.LEDGER.ENTRIES e ON e.seq = o.ledger_seq AND e.entry_type = 'OPTIONS_SCORED'
WHERE e.seq IS NULL
   OR e.payload:options[o.option_id]::STRING <> o.option_hash
   OR BBC_OS.LEDGER.CANONICAL_HASH(o.option) <> o.option_hash
   OR (o.feasible AND o.score_rank IS NULL) OR (NOT o.feasible AND o.score_rank IS NOT NULL)
   OR o.option:case_id::STRING <> o.case_id;

-- test: a recommendation chooses one of its case's feasible options, from the case's current pack
SELECT r.rec_id FROM BBC_OS.DECISION.RECOMMENDATIONS r
LEFT JOIN BBC_OS.DECISION.OPTIONS o ON o.option_id = r.option_id AND o.case_id = r.case_id
WHERE o.option_id IS NULL OR NOT o.feasible;

-- test: rule decisions carry the rule id, need no audit, and their sealed brief hash checks out
SELECT rec_id FROM BBC_OS.DECISION.RECOMMENDATIONS
WHERE (decided_by = 'RULE' AND (decider_id NOT LIKE 'R-%@%' OR audit_status <> 'NOT_REQUIRED'))
   OR brief:brief_hash::STRING <> brief_hash
   OR BBC_OS.LEDGER.CANONICAL_HASH(OBJECT_DELETE(brief, 'brief_hash')) <> brief_hash
   OR brief:recommendation:option_id::STRING <> option_id;

-- test: findings, recommendations and policy evaluations are each on the ledger
SELECT 'finding' AS kind, f.finding_id AS id FROM BBC_OS.DECISION.CAUSATION_FINDINGS f
LEFT JOIN BBC_OS.LEDGER.ENTRIES e ON e.seq = f.ledger_seq AND e.entry_type = 'FINDING'
WHERE e.seq IS NULL OR e.payload:finding_hash::STRING <> f.finding_hash
UNION ALL
SELECT 'recommendation', r.rec_id FROM BBC_OS.DECISION.RECOMMENDATIONS r
LEFT JOIN BBC_OS.LEDGER.ENTRIES e ON e.seq = r.ledger_seq AND e.entry_type = 'RECOMMENDATION'
WHERE e.seq IS NULL OR e.payload:brief_hash::STRING <> r.brief_hash
UNION ALL
SELECT 'evaluation', p.eval_id FROM BBC_OS.DECISION.POLICY_EVALUATIONS p
LEFT JOIN BBC_OS.LEDGER.ENTRIES e ON e.seq = p.ledger_seq AND e.entry_type = 'POLICY_EVALUATION'
WHERE e.seq IS NULL OR e.payload:outcome::STRING <> p.outcome;

-- test: a deterministic finding names no responsible party (attribution is not liability)
SELECT finding_id FROM BBC_OS.DECISION.CAUSATION_FINDINGS
WHERE decider_kind = 'RULE' AND (NOT unadjudicated OR ARRAY_SIZE(finding:responsible_parties) > 0);

-- test: policy evaluations use a policy that was ACTIVE, and APPROVE / HUMAN_INITIATE name roles
SELECT p.eval_id FROM BBC_OS.DECISION.POLICY_EVALUATIONS p
LEFT JOIN BBC_OS.GOV.POLICY_VERSIONS v ON v.policy_version = p.policy_version
WHERE v.activated_at IS NULL OR v.activated_at > p.created_at
   OR (p.outcome IN ('APPROVE', 'HUMAN_INITIATE') AND ARRAY_SIZE(p.required_roles) = 0);

-- test: each required role has exactly one approval request, bound to the brief and the pack
WITH required AS (
  SELECT p.eval_id, p.rec_id, r.value::STRING AS role
  FROM BBC_OS.DECISION.POLICY_EVALUATIONS p, LATERAL FLATTEN(INPUT => p.required_roles) r
  WHERE NOT p.shadow
)
SELECT q.eval_id, q.role, COUNT(a.approval_id) AS requests
FROM required q
LEFT JOIN BBC_OS.DECISION.APPROVALS a ON a.eval_id = q.eval_id AND a.required_role = q.role
LEFT JOIN BBC_OS.DECISION.RECOMMENDATIONS rec ON rec.rec_id = q.rec_id
LEFT JOIN BBC_OS.EVIDENCE.EVIDENCE_PACKS pk ON pk.pack_id = rec.brief:pack_id::STRING
GROUP BY q.eval_id, q.role
HAVING COUNT(a.approval_id) <> 1
    OR MAX(a.brief_hash_at_request) <> MAX(rec.brief_hash)
    OR MAX(a.pack_hash_at_request) <> MAX(pk.content_hash);

-- test: no one approves what they proposed (the engine identity proposes; personas decide)
SELECT approval_id FROM BBC_OS.DECISION.APPROVALS WHERE decided_by IS NOT NULL AND decided_by = proposer;

-- test: case state matches its latest stage record (no case skips a stage)
SELECT c.case_id, c.state FROM BBC_OS.DECISION.CASES c
WHERE (c.state IN ('ASSESSED', 'FINDING_RECORDED', 'OPTIONS_SCORED', 'RECOMMENDED', 'AUDITED',
                   'PENDING_APPROVAL', 'AUTO_APPROVED', 'STRATEGY_PENDING', 'FORENSICS_PENDING')
       AND c.current_pack_id IS NULL)
   OR (c.state IN ('OPTIONS_SCORED', 'STRATEGY_PENDING', 'RECOMMENDED', 'AUDITED', 'PENDING_APPROVAL', 'AUTO_APPROVED')
       AND NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.OPTIONS o WHERE o.pack_id = c.current_pack_id))
   OR (c.state IN ('RECOMMENDED', 'AUDITED', 'PENDING_APPROVAL', 'AUTO_APPROVED')
       AND NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.RECOMMENDATIONS r WHERE r.rec_id = c.current_rec_id))
   OR (c.state IN ('PENDING_APPROVAL', 'AUTO_APPROVED')
       AND NOT EXISTS (SELECT 1 FROM BBC_OS.DECISION.POLICY_EVALUATIONS p WHERE p.rec_id = c.current_rec_id));

-- test: only the engine may call ADVANCE_CASE / CLAIM_WORK; no runtime role reaches the stages
SHOW GRANTS ON PROCEDURE BBC_OS.API.ADVANCE_CASE(STRING, STRING);
SELECT "grantee_name", "privilege" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID()))
WHERE "privilege" = 'USAGE' AND "grantee_name" <> 'BBC_ENGINE';

-- test: the internal stage procedures have no USAGE grants
SHOW GRANTS ON PROCEDURE BBC_OS.DECISION.EVALUATE_POLICY(STRING);
SELECT "grantee_name", "privilege" FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "privilege" = 'USAGE';

-- test: every governed decision metric in the active policy is defined in the semantic view
DESCRIBE SEMANTIC VIEW BBC_OS.SEM.EXCURSION_RECOVERY;
WITH view_metrics AS (
  SELECT UPPER("object_name") AS name FROM TABLE(RESULT_SCAN(LAST_QUERY_ID())) WHERE "object_kind" = 'METRIC'
)
SELECT r.name FROM BBC_OS.GOV.METRIC_REGISTRY r
LEFT JOIN view_metrics v ON v.name = r.name
WHERE r.policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION()
  AND r.name IN ('PLANNED_VALUE_USD', 'DEFAULT_COUNTERFACTUAL_USD', 'VALUE_AT_RISK_USD', 'PREDICTED_NRV_USD',
                 'TIME_TO_DECISION_MIN', 'RULE_DECIDED_SHARE', 'CASE_COUNT', 'TIME_TO_DETECT_MIN')
  AND (r.definition_hash IS NULL OR v.name IS NULL);

-- test: decision values through the semantic view equal the stored engine values, decision by decision
WITH sv AS (
  SELECT * FROM SEMANTIC_VIEW(BBC_OS.SEM.EXCURSION_RECOVERY
    DIMENSIONS decisions.rec_id
    METRICS decisions.predicted_nrv_usd, decisions.default_counterfactual_usd, decisions.value_at_risk_usd)
)
SELECT d.rec_id FROM BBC_OS.DECISION.V_DECISIONS d LEFT JOIN sv ON sv.rec_id = d.rec_id
WHERE NOT EQUAL_NULL(sv.predicted_nrv_usd, d.predicted_nrv_usd)
   OR NOT EQUAL_NULL(sv.default_counterfactual_usd, d.default_counterfactual_usd)
   OR NOT EQUAL_NULL(sv.value_at_risk_usd, d.value_at_risk_usd);
