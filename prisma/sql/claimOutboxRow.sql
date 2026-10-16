-- Globally oldest unprocessed outbox row (audit.claim_outbox_row, A-B9.5).
SELECT context, id, payload, "createdAt" FROM audit.claim_outbox_row();
