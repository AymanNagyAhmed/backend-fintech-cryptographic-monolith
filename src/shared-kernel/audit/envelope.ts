import { z } from 'zod';
import { ActorSchema } from './actor.js';

/** Shared fields every audit event carries before the type-specific payload. */
export const AuditEnvelopeFields = {
  /** Stable type id, e.g. `transfer.completed`. */
  type: z.string().min(1).max(64),
  /** Schema revision for this type; bump when the allow-list changes. */
  schemaVersion: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  actor: ActorSchema,
  requestId: z.string().min(1).max(64).optional(),
  partitionKey: z.string().min(1).max(64).optional(),
  /** SHA-256 of Transit ciphertext for a PII field (A-B11.2); never plaintext. */
  ciphertextHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
} as const;
