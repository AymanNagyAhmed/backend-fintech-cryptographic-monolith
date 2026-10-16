import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const WalletCreatedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('wallet.created'),
    schemaVersion: z.literal(1),
    walletId: z.string().uuid(),
    currency: z.enum(['AED', 'USD', 'EUR', 'BTC']),
    ledgerAccountId: z.string().uuid(),
  })
  .strict();

export type WalletCreatedV1 = z.infer<typeof WalletCreatedV1Schema>;
