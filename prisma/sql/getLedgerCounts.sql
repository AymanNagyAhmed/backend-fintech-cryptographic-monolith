SELECT (SELECT COUNT(*) FROM ledger.accounts) AS accounts,
       (SELECT COUNT(*) FROM ledger.postings) AS postings,
       (SELECT COUNT(*) FROM ledger.ledger_entries) AS entries
