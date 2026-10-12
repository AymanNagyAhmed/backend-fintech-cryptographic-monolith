import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator.js';
import type { AuthenticatedRequest, AuthUser } from './auth.types.js';
import { ROLES_KEY } from './decorators/roles.decorator.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { RolesGuard } from './roles.guard.js';
import type { TokenService } from './token.service.js';

const context = (req: Partial<AuthenticatedRequest>) =>
  ({
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflectorWith = (meta: Record<string, unknown>) =>
  ({
    getAllAndOverride: (key: string) => meta[key],
  }) as unknown as Reflector;

const alice: AuthUser = { id: 'u1', roles: ['user'], sessionId: 's1' };

describe('JwtAuthGuard', () => {
  const tokens = {
    verifyAccessToken: vi.fn(),
  } as unknown as TokenService & {
    verifyAccessToken: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => tokens.verifyAccessToken.mockReset());

  it('lets @Public() routes through without a token', async () => {
    const guard = new JwtAuthGuard(
      reflectorWith({ [IS_PUBLIC_KEY]: true }),
      tokens,
    );
    await expect(guard.canActivate(context({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Basic abc', 'Bearer', 'Bearer '])(
    'rejects the authorization header %j',
    async (authorization) => {
      const guard = new JwtAuthGuard(reflectorWith({}), tokens);
      await expect(
        guard.canActivate(context({ headers: { authorization } })),
      ).rejects.toThrow(UnauthorizedException);
    },
  );

  it('verifies the bearer token and attaches the user', async () => {
    tokens.verifyAccessToken.mockResolvedValue(alice);
    const req: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer tok' },
    };
    const guard = new JwtAuthGuard(reflectorWith({}), tokens);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(tokens.verifyAccessToken).toHaveBeenCalledWith('tok');
    expect(req.user).toBe(alice);
  });
});

describe('RolesGuard', () => {
  it('allows any authenticated user when no role is required', () => {
    const guard = new RolesGuard(reflectorWith({}));
    expect(guard.canActivate(context({ user: alice }))).toBe(true);
  });

  it('allows a user with one of the required roles', () => {
    const guard = new RolesGuard(
      reflectorWith({ [ROLES_KEY]: ['admin', 'user'] }),
    );
    expect(guard.canActivate(context({ user: alice }))).toBe(true);
  });

  it('forbids a user without the role, and a request without a user', () => {
    const guard = new RolesGuard(reflectorWith({ [ROLES_KEY]: ['admin'] }));
    expect(() => guard.canActivate(context({ user: alice }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard.canActivate(context({}))).toThrow(ForbiddenException);
  });
});
