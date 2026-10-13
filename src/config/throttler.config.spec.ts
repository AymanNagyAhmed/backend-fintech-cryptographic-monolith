import { Controller, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { ThrottleByAccount } from '../common/throttler/decorators/throttle-by-account.decorator.js';
import {
  ACCOUNT_THROTTLER,
  accountTracker,
  IP_THROTTLER,
  RATE_LIMITS,
  throttlerOptions,
} from './throttler.config.js';

@Controller()
class SampleController {
  @ThrottleByAccount()
  login() {}

  other() {}
}

const contextFor = (handler: keyof SampleController) =>
  ({
    getHandler: () => SampleController.prototype[handler],
    getClass: () => SampleController,
  }) as unknown as ExecutionContext;

describe('throttler config', () => {
  const storage = {} as ThrottlerStorage;
  const options = throttlerOptions(storage, new Reflector());
  if (Array.isArray(options)) throw new Error('expected the object form');
  const byName = (name: string) =>
    options.throttlers.find((t) => t.name === name)!;

  it('uses the given storage and a client-facing message', () => {
    expect(options.storage).toBe(storage);
    expect(options.errorMessage).not.toMatch(/Throttler/);
  });

  it('limits every route per IP and only marked routes per account', () => {
    expect(byName(IP_THROTTLER).skipIf).toBeUndefined();
    const skipIf = byName(ACCOUNT_THROTTLER).skipIf!;
    expect(skipIf(contextFor('login'))).toBe(false);
    expect(skipIf(contextFor('other'))).toBe(true);
  });

  it('keys accounts by the normalized email', () => {
    expect(accountTracker({ body: { email: '  Alice@Example.COM ' } })).toBe(
      'alice@example.com',
    );
    expect(accountTracker({ body: { email: 42 } })).toBe('');
    expect(accountTracker({})).toBe('');
  });

  it('keeps auth routes tighter than the default', () => {
    for (const route of ['register', 'login', 'totp'] as const) {
      expect(RATE_LIMITS[route].limit).toBeLessThan(RATE_LIMITS.default.limit);
    }
    expect(RATE_LIMITS.login.blockDuration).toBeGreaterThan(
      RATE_LIMITS.login.ttl,
    );
  });
});
