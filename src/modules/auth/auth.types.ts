import type { Request } from 'express';

// Same values as the auth.user_role enum (checked in auth.types.spec.ts). Other modules use
// these strings, not the generated Prisma enum, so they never import auth's schema types.
export const ROLES = ['user', 'approver', 'compliance', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** Roles that only count in an access token whose login passed TOTP (RolesGuard). */
export const PRIVILEGED_ROLES: readonly Role[] = [
  'approver',
  'compliance',
  'admin',
];

/** The caller of a protected route, taken from the verified access token. */
export interface AuthUser {
  id: string;
  roles: Role[];
  /** Refresh-token family of the login session that issued the access token. */
  sessionId: string;
  /** The login of this session passed a TOTP code. */
  mfa: boolean;
}

/** The B2B caller of a @SignedRequest() route, after SignedRequestGuard checked its signature. */
export interface ApiClientRef {
  id: string;
  clientId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  apiClient?: ApiClientRef;
  /** Exact request bytes; set because the app is created with `rawBody: true`. */
  rawBody?: Buffer;
}

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
  sid: string;
  mfa: boolean;
}

export const JWT_ISSUER = 'fintech-backend';
export const JWT_AUDIENCE = 'fintech-api';
