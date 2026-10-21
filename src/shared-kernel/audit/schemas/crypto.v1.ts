import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

/** Why `SignerService.verify` returned false. Never a key-store outage. */
export const SIGNATURE_REJECTION_REASONS = [
  'malformed',
  'unknown_key',
  'revoked',
  'mismatch',
] as const;

export type SignatureRejectionReason =
  (typeof SIGNATURE_REJECTION_REASONS)[number];

/**
 * A signature check failed (challenge 006). `keyId` is present only when the
 * envelope parsed. The signature bytes, the payload, and secrets stay off the chain.
 */
export const CryptoSignatureRejectedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('crypto.signature.rejected'),
    schemaVersion: z.literal(1),
    reason: z.enum(SIGNATURE_REJECTION_REASONS),
    keyId: z.string().min(1).max(96).optional(),
  })
  .strict();

export type CryptoSignatureRejectedV1 = z.infer<
  typeof CryptoSignatureRejectedV1Schema
>;
