-- Rows the chainer has not consumed yet, per context (expect 0 once the system has drained).
SELECT ctx, count(*) AS pending FROM (
  SELECT 'auth' AS ctx FROM auth.outbox WHERE processed_at IS NULL
  UNION ALL SELECT 'wallet' FROM wallet.outbox WHERE processed_at IS NULL
  UNION ALL SELECT 'ledger' FROM ledger.outbox WHERE processed_at IS NULL
  UNION ALL SELECT 'payments' FROM payments.outbox WHERE processed_at IS NULL
  UNION ALL SELECT 'withdrawals' FROM withdrawals.outbox WHERE processed_at IS NULL
) t GROUP BY ctx;
