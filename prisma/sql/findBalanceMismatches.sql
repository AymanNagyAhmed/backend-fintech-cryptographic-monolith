-- Accounts whose cached balance differs from the sum of their entries; total = all such
-- accounts, before the LIMIT
-- @param {Int} $1:limit
SELECT a.id, a.currency, a.balance::text AS cached, s.total::text AS computed,
       (a.balance - s.total)::text AS difference, COUNT(*) OVER () AS total
FROM ledger.accounts a
CROSS JOIN LATERAL (
  SELECT COALESCE(SUM(e.amount), 0::numeric(20, 8)) AS total
  FROM ledger.ledger_entries e
  WHERE e.account_id = a.id
) s
WHERE a.balance <> s.total
ORDER BY a.id
LIMIT $1
