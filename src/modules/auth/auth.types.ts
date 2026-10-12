import type { Request } from 'express';

// Same values as the auth.user_role enum (checked in auth.types.spec.ts). Other modules use
// these strings, not the generated Prisma enum, so they never import auth's schema types.
export const ROLES = ['user', 'approver', 'compliance', 'admin'] as const;
export type Role = (typeof ROLES)[number];

/** The caller of a protected route, taken from the verified access token. */
export interface AuthUser {
  id: string;
  roles: Role[];
  /** Refresh-token family of the login session that issued the access token. */
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
  sid: string;
}

export const JWT_ISSUER = 'fintech-backend';
export const JWT_AUDIENCE = 'fintech-api';
