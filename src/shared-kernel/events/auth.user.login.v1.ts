import {
  AuthUserLoginV1Schema,
  type AuthUserLoginV1,
} from '../audit/schemas/auth.v1.js';
import { defineEventContract } from './event-contract.js';

/** `auth.user.login` v1: payload type and contract. Frozen; a change is `auth.user.login.v2.ts`. */
export type { AuthUserLoginV1 };

export const AUTH_USER_LOGIN_V1 = defineEventContract({
  type: 'auth.user.login',
  schemaVersion: 1,
  schema: AuthUserLoginV1Schema,
});
