import {
  PaymentWebhookAcceptedV1Schema,
  type PaymentWebhookAcceptedV1,
} from '../audit/schemas/payment.v1.js';
import { defineEventContract } from './event-contract.js';

/** `payment.webhook.accepted` v1: payload type and contract. Frozen; a change is `payment.webhook.accepted.v2.ts`. */
export type { PaymentWebhookAcceptedV1 };

export const PAYMENT_WEBHOOK_ACCEPTED_V1 = defineEventContract({
  type: 'payment.webhook.accepted',
  schemaVersion: 1,
  schema: PaymentWebhookAcceptedV1Schema,
});
