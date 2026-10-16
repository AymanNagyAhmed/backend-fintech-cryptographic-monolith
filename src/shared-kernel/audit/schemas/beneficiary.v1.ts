import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const BeneficiaryConfirmedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('beneficiary.confirmed'),
    schemaVersion: z.literal(1),
    beneficiaryId: z.string().uuid(),
    currency: z.enum(['AED', 'USD', 'EUR', 'BTC']),
    network: z.string().min(1).max(64),
    activeAt: z.iso.datetime(),
  })
  .strict();

export type BeneficiaryConfirmedV1 = z.infer<
  typeof BeneficiaryConfirmedV1Schema
>;
