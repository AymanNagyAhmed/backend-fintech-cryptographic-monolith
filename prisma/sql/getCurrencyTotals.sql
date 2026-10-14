-- Trial balance: per currency, cached balances and entries must each sum to 0
WITH b AS (
  SELECT currency, COUNT(*) AS accounts, SUM(balance) AS balances
  FROM ledger.accounts
  GROUP BY currency
), e AS (
  SELECT currency, SUM(amount) AS entries
  FROM ledger.ledger_entries
  GROUP BY currency
)
SELECT b.currency, b.accounts, b.balances::text AS balances,
       COALESCE(e.entries, 0::numeric(20, 8))::text AS entries
FROM b
LEFT JOIN e USING (currency)
ORDER BY b.currency
