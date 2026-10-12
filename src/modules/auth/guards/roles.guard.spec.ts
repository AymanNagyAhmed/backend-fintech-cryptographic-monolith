import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthenticatedRequest, AuthUser, Role } from '../auth.types.js';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { RolesGuard } from './roles.guard.js';

const context = (req: Partial<AuthenticatedRequest>) =>
  ({
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const guardFor = (required?: Role[]) =>
  new RolesGuard({
    getAllAndOverride: (key: string) =>
      key === ROLES_KEY ? required : undefined,
  } as unknown as Reflector);

const userWith = (roles: Role[], mfa: boolean): AuthUser => ({
  id: 'u1',
  roles,
  sessionId: 's1',
  mfa,
});

describe('RolesGuard', () => {
  it('allows any authenticated user when no role is required', () => {
    expect(
      guardFor().canActivate(context({ user: userWith(['user'], false) })),
    ).toBe(true);
  });

  it('allows a user with one of the required roles', () => {
    expect(
      guardFor(['admin', 'user']).canActivate(
        context({ user: userWith(['user'], false) }),
      ),
    ).toBe(true);
  });

  it('forbids a user without the role, and a request without a user', () => {
    const guard = guardFor(['admin']);
    expect(() =>
      guard.canActivate(context({ user: userWith(['user'], true) })),
    ).toThrow(ForbiddenException);
    expect(() => guard.canActivate(context({}))).toThrow(ForbiddenException);
  });

  it('a privileged role needs a session that passed TOTP', () => {
    const guard = guardFor(['admin']);
    expect(() =>
      guard.canActivate(context({ user: userWith(['user', 'admin'], false) })),
    ).toThrow(
      expect.objectContaining({ code: 'MFA_REQUIRED', statusCode: 403 }),
    );
    expect(
      guard.canActivate(context({ user: userWith(['user', 'admin'], true) })),
    ).toBe(true);
  });

  it('a non-privileged role that matches is enough without TOTP', () => {
    expect(
      guardFor(['user', 'approver']).canActivate(
        context({ user: userWith(['user', 'approver'], false) }),
      ),
    ).toBe(true);
  });
});
