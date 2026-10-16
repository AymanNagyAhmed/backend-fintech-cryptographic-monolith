-- A-B15.4 invariants after the chaos run. Every query must return 0 rows.
-- Audit sequences start at 1, so a gapless partition has count(*) = max(seq)
-- (the plan's `max(seq)+1` assumes 0-based sequences).

\echo 'partition gaps or duplicates (expect 0 rows)'
SELECT partition_key, count(*) AS events, max(seq) AS expected
FROM audit.audit_events GROUP BY 1 HAVING count(*) <> max(seq);

\echo 'broken prev_hash links inside a partition (expect 0 rows)'
SELECT partition_key, seq FROM (
  SELECT partition_key, seq, prev_hash,
         lag(hash) OVER (PARTITION BY partition_key ORDER BY seq) AS expected_prev
  FROM audit.audit_events
) t
WHERE seq > 1 AND prev_hash <> expected_prev;

-- Ledger balance and posting invariants are checked by `npm run job:reconcile` (run.sh).
