import {
  AuthUserRegisteredV1Schema,
  type AuthUserRegisteredV1,
} from '../audit/schemas/auth.v1.js';
import { defineEventContract } from './event-contract.js';

/** `auth.user.registered` v1: payload type and contract. Frozen; a change is `auth.user.registered.v2.ts`. */
export type { AuthUserRegisteredV1 };

export const AUTH_USER_REGISTERED_V1 = defineEventContract({
  type: 'auth.user.registered',
  schemaVersion: 1,
  schema: AuthUserRegisteredV1Schema,
});
