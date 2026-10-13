import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import {
  minutes,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { THROTTLE_BY_ACCOUNT_KEY } from '../common/throttler/decorators/throttle-by-account.decorator.js';

/** Throttler names; `default` keeps the standard `X-RateLimit-*` / `Retry-After` header names. */
export const IP_THROTTLER = 'default';
export const ACCOUNT_THROTTLER = 'account';

/**
 * Counters are per route and per client IP (per account for ACCOUNT_THROTTLER).
 * `blockDuration` defaults to `ttl`: once over the limit, the key is blocked that long.
 */
export const RATE_LIMITS = {
  default: { limit: 120, ttl: minutes(1) },
  account: { limit: 10, ttl: minutes(15), blockDuration: minutes(15) },
  register: { limit: 10, ttl: minutes(60) },
  login: { limit: 10, ttl: minutes(1), blockDuration: minutes(5) },
  refresh: { limit: 30, ttl: minutes(1) },
  logout: { limit: 30, ttl: minutes(1) },
  totp: { limit: 5, ttl: minutes(1), blockDuration: minutes(5) },
} as const;

export const RATE_LIMIT_MESSAGE = 'Too many requests. Please retry later.';

/** Same normalization as `UsersService`, so `Alice@x` and `alice@x` share a counter. */
export function accountTracker(req: Record<string, unknown>): string {
  const email = (req as unknown as Request).body?.email as unknown;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function throttlerOptions(
  storage: ThrottlerStorage,
  reflector: Reflector,
): ThrottlerModuleOptions {
  const byAccount = (context: ExecutionContext) =>
    reflector.getAllAndOverride<boolean | undefined>(THROTTLE_BY_ACCOUNT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) === true;

  return {
    storage,
    errorMessage: RATE_LIMIT_MESSAGE,
    throttlers: [
      { name: IP_THROTTLER, ...RATE_LIMITS.default },
      {
        name: ACCOUNT_THROTTLER,
        ...RATE_LIMITS.account,
        getTracker: accountTracker,
        skipIf: (context) => !byAccount(context),
      },
    ],
  };
}
