# Data retention and crypto-shredding (A-B11.4)

## Legal basis for retaining financial records

Financial transaction records (ledger entries, transfers, balances, payment webhook acceptances) are retained after a subject exercises the right to erasure because they are required for:

- Anti-money-laundering and counter-terrorist financing obligations
- Accounting, tax, and prudential reporting
- Dispute resolution and chargeback handling
- Cryptographic audit integrity (hash chains and Merkle checkpoints must remain verifiable)

These records are kept under a **legitimate interest / legal obligation** basis for financial record-keeping. They do **not** contain plaintext PII after erasure: identity in the audit trail is an opaque `subjectRef`, and any vaulted PII ciphertext becomes permanently unreadable when the per-subject OpenBao Transit key is destroyed (`deletion_allowed=true`).

## What erasure does

1. A compliance user requests `POST /v1/privacy/erasure/:userId`.
2. A **different** compliance/admin user approves (`…/approve`) — four-eyes.
3. The subject Transit key `subject-<userId>` is deleted.
4. An `erasure.completed` audit event is chained.
5. Ledger and wallet financial rows remain; proofs and chain verification still succeed.

## What erasure does not do

- It does not rewrite or delete `audit.audit_events` or `ledger.*` rows.
- It does not remove signed tree heads, TSA tokens, or WORM copies.
- Login identifiers in `auth.users` may be redacted in a later hardening step; until then treat operational email storage as separate from the shreddable privacy vault.
