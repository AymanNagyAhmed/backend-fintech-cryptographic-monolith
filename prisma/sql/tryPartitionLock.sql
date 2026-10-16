-- Transaction-scoped advisory lock for one hash-chain partition (A-B9.6).
-- hashtext(partition_key) is stable within a database; false means another writer holds it.
SELECT pg_try_advisory_xact_lock(hashtext($1::text)) AS locked;
