import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const AuthUserRegisteredV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('auth.user.registered'),
    schemaVersion: z.literal(1),
    userId: z.string().uuid(),
  })
  .strict();

export const AuthUserLoginV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('auth.user.login'),
    schemaVersion: z.literal(1),
    userId: z.string().uuid(),
    mfa: z.boolean(),
  })
  .strict();

export type AuthUserRegisteredV1 = z.infer<typeof AuthUserRegisteredV1Schema>;
export type AuthUserLoginV1 = z.infer<typeof AuthUserLoginV1Schema>;
