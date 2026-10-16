import type { z } from 'zod';
import {
  AuthUserLoginV1Schema,
  AuthUserRegisteredV1Schema,
} from './schemas/auth.v1.js';
import { PaymentWebhookAcceptedV1Schema } from './schemas/payment.v1.js';
import { TransferCompletedV1Schema } from './schemas/transfer.v1.js';
import { WalletCreatedV1Schema } from './schemas/wallet.v1.js';

/**
 * Allow-listed audit event schemas keyed by `type` + `schemaVersion` (2.12).
 * Adding a field requires a new schema version; unknown types and unknown
 * fields are rejected by `parseAuditEvent`.
 */
export const AUDIT_EVENT_SCHEMAS = {
  'auth.user.registered': { 1: AuthUserRegisteredV1Schema },
  'auth.user.login': { 1: AuthUserLoginV1Schema },
  'wallet.created': { 1: WalletCreatedV1Schema },
  'transfer.completed': { 1: TransferCompletedV1Schema },
  'payment.webhook.accepted': { 1: PaymentWebhookAcceptedV1Schema },
} as const;

export type AuditEventType = keyof typeof AUDIT_EVENT_SCHEMAS;

export type AuditEvent =
  | z.infer<typeof AuthUserRegisteredV1Schema>
  | z.infer<typeof AuthUserLoginV1Schema>
  | z.infer<typeof WalletCreatedV1Schema>
  | z.infer<typeof TransferCompletedV1Schema>
  | z.infer<typeof PaymentWebhookAcceptedV1Schema>;

export function schemaOf(
  type: string,
  schemaVersion: number,
): z.ZodType<AuditEvent> | null {
  const versions = AUDIT_EVENT_SCHEMAS[type as AuditEventType];
  if (!versions) return null;
  const schema = (versions as Record<number, z.ZodType<AuditEvent>>)[
    schemaVersion
  ];
  return schema ?? null;
}
