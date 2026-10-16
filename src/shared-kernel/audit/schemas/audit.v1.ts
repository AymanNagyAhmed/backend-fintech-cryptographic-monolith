import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

/** Read/verify of audit data is itself audited (A-B9.8 / 2.1). */
export const AuditAccessV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('audit.access'),
    schemaVersion: z.literal(1),
    operation: z.enum(['verify', 'proof', 'consistency', 'search', 'export']),
    /** Optional scope the caller asked for (partition, id, range). */
    scope: z.string().min(1).max(256).optional(),
  })
  .strict();

export type AuditAccessV1 = z.infer<typeof AuditAccessV1Schema>;
