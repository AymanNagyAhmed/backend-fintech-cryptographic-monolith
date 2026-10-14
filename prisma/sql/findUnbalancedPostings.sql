-- Postings that are not a valid double entry: fewer than two entries, several currencies,
-- or amounts that do not sum to 0; total = all such postings, before the LIMIT
-- @param {Int} $1:limit
SELECT p.ref, COUNT(e.id) AS entries, COUNT(DISTINCT e.currency) AS currencies,
       COALESCE(SUM(e.amount), 0::numeric(20, 8))::text AS sum, COUNT(*) OVER () AS total
FROM ledger.postings p
LEFT JOIN ledger.ledger_entries e ON e.ref = p.ref
GROUP BY p.ref
HAVING COUNT(e.id) < 2
    OR COUNT(DISTINCT e.currency) <> 1
    OR COALESCE(SUM(e.amount), 0) <> 0
ORDER BY p.ref
LIMIT $1
