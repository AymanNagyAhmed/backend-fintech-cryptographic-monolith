import { z } from 'zod';
import { AuditEnvelopeFields } from '../envelope.js';

export const PaymentWebhookAcceptedV1Schema = z
  .object({
    ...AuditEnvelopeFields,
    type: z.literal('payment.webhook.accepted'),
    schemaVersion: z.literal(1),
    provider: z.string().min(1).max(32),
    providerEventId: z.string().min(1).max(128),
    walletId: z.string().uuid().optional(),
  })
  .strict();

export type PaymentWebhookAcceptedV1 = z.infer<
  typeof PaymentWebhookAcceptedV1Schema
>;
