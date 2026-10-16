import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

/** Money is always a decimal string (never a JS number). */
const Amount = z.string().regex(/^(0|[1-9]\d*)(\.\d{1,8})?$/, 'decimal string');

export const TransferCompletedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('transfer.completed'),
    schemaVersion: z.literal(1),
    transferId: z.string().uuid(),
    sourceWalletId: z.string().uuid(),
    destinationWalletId: z.string().uuid(),
    currency: z.enum(['AED', 'USD', 'EUR', 'BTC']),
    amount: Amount,
  })
  .strict();

export type TransferCompletedV1 = z.infer<typeof TransferCompletedV1Schema>;
