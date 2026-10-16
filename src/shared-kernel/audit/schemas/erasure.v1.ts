import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const ErasureCompletedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('erasure.completed'),
    schemaVersion: z.literal(1),
    subjectRef: z.string().uuid(),
    requesterId: z.string().uuid(),
    approverId: z.string().uuid(),
  })
  .strict();

export type ErasureCompletedV1 = z.infer<typeof ErasureCompletedV1Schema>;
