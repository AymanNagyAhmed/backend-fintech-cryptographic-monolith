import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { UsersService } from '../../users/users.service.js';
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

const guardFor = (required?: Role[], stored?: Role[] | null) => {
  const rolesOf = vi.fn(async () => stored ?? null);
  const guard = new RolesGuard(
    {
      getAllAndOverride: (key: string) =>
        key === ROLES_KEY ? required : undefined,
    } as unknown as Reflector,
    { rolesOf } as unknown as UsersService,
  );
  return { guard, rolesOf };
};

const userWith = (roles: Role[], mfa: boolean): AuthUser => ({
  id: 'u1',
  roles,
  sessionId: 's1',
  mfa,
});

describe('RolesGuard', () => {
  it('allows any authenticated user when no role is required', async () => {
    const { guard, rolesOf } = guardFor();
    await expect(
      guard.canActivate(context({ user: userWith(['user'], false) })),
    ).resolves.toBe(true);
    expect(rolesOf).not.toHaveBeenCalled();
  });

  it('uses the token when the route only requires user', async () => {
    const { guard, rolesOf } = guardFor(['user'], ['admin']);
    await expect(
      guard.canActivate(context({ user: userWith(['user'], false) })),
    ).resolves.toBe(true);
    expect(rolesOf).not.toHaveBeenCalled();
  });

  it('allows a privileged route from the database role, not the token', async () => {
    const { guard, rolesOf } = guardFor(['admin'], ['user', 'admin']);
    await expect(
      guard.canActivate(context({ user: userWith(['user'], true) })),
    ).resolves.toBe(true);
    expect(rolesOf).toHaveBeenCalledWith('u1');
  });

  it('forbids a demoted user and a missing user on a privileged route', async () => {
    const demoted = guardFor(['admin'], ['user']);
    await expect(
      demoted.guard.canActivate(context({ user: userWith(['admin'], true) })),
    ).rejects.toThrow(ForbiddenException);

    const missing = guardFor(['admin'], null);
    await expect(
      missing.guard.canActivate(context({ user: userWith(['admin'], true) })),
    ).rejects.toThrow(ForbiddenException);

    const { guard } = guardFor(['admin'], ['admin']);
    await expect(guard.canActivate(context({}))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('a privileged role needs a session that passed TOTP', async () => {
    const guard = guardFor(['admin'], ['user', 'admin']).guard;
    await expect(
      guard.canActivate(context({ user: userWith(['user', 'admin'], false) })),
    ).rejects.toThrow(
      expect.objectContaining({ code: 'MFA_REQUIRED', statusCode: 403 }),
    );
    await expect(
      guard.canActivate(context({ user: userWith(['user', 'admin'], true) })),
    ).resolves.toBe(true);
  });

  it('a non-privileged role that matches is enough without TOTP', async () => {
    const { guard } = guardFor(['user', 'approver'], ['user', 'approver']);
    await expect(
      guard.canActivate(context({ user: userWith(['user'], false) })),
    ).resolves.toBe(true);
  });
});
