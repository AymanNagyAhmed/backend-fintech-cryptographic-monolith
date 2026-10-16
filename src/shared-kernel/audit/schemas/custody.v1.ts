import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const CustodySignV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('custody.sign'),
    schemaVersion: z.literal(1),
    operationId: z.string().uuid(),
    operationType: z.literal('withdrawal'),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    keyId: z.string().min(1).max(128),
    alg: z.enum(['ed25519', 'ecdsa-p256', 'ml-dsa-65']),
  })
  .strict();

export type CustodySignV1 = z.infer<typeof CustodySignV1Schema>;
