-- Locks in id order, so concurrent postings over the same accounts cannot deadlock
SELECT id, currency, kind, allow_negative, balance, status
FROM ledger.accounts
WHERE id = ANY($1::uuid[])
ORDER BY id
FOR UPDATE
