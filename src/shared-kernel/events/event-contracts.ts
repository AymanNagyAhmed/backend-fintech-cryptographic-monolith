import { AUTH_USER_REGISTERED_V1 } from './auth.user.registered.v1.js';
import { AUTH_USER_LOGIN_V1 } from './auth.user.login.v1.js';
import { WALLET_CREATED_V1 } from './wallet.created.v1.js';
import { TRANSFER_COMPLETED_V1 } from './transfer.completed.v1.js';
import { PAYMENT_WEBHOOK_ACCEPTED_V1 } from './payment.webhook.accepted.v1.js';
import { AUDIT_ACCESS_V1 } from './audit.access.v1.js';
import { ERASURE_COMPLETED_V1 } from './erasure.completed.v1.js';
import { BENEFICIARY_CONFIRMED_V1 } from './beneficiary.confirmed.v1.js';
import { CUSTODY_SIGN_V1 } from './custody.sign.v1.js';

/**
 * Every published event contract. Keep in step with `AUDIT_EVENT_SCHEMAS`
 * (`event-contracts.spec.ts` fails when a type or version is missing on either side).
 */
export const EVENT_CONTRACTS = [
  AUTH_USER_REGISTERED_V1,
  AUTH_USER_LOGIN_V1,
  WALLET_CREATED_V1,
  TRANSFER_COMPLETED_V1,
  PAYMENT_WEBHOOK_ACCEPTED_V1,
  AUDIT_ACCESS_V1,
  ERASURE_COMPLETED_V1,
  BENEFICIARY_CONFIRMED_V1,
  CUSTODY_SIGN_V1,
] as const;

export type PublishedEventContract = (typeof EVENT_CONTRACTS)[number];
