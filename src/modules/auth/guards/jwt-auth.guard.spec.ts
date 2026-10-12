import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator.js';
import type { AuthenticatedRequest, AuthUser } from '../auth.types.js';
import type { TokenService } from '../token.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

const context = (req: Partial<AuthenticatedRequest>) =>
  ({
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  }) as unknown as ExecutionContext;

const reflectorWith = (meta: Record<string, unknown>) =>
  ({ getAllAndOverride: (key: string) => meta[key] }) as unknown as Reflector;

const alice: AuthUser = {
  id: 'u1',
  roles: ['user'],
  sessionId: 's1',
  mfa: false,
};

describe('JwtAuthGuard', () => {
  const verifyAccessToken = vi.fn();
  const tokens = { verifyAccessToken } as unknown as TokenService;

  beforeEach(() => verifyAccessToken.mockReset());

  it('lets @Public() routes through without a token', async () => {
    const guard = new JwtAuthGuard(
      reflectorWith({ [IS_PUBLIC_KEY]: true }),
      tokens,
    );
    await expect(guard.canActivate(context({ headers: {} }))).resolves.toBe(
      true,
    );
    expect(verifyAccessToken).not.toHaveBeenCalled();
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
    verifyAccessToken.mockResolvedValue(alice);
    const req: Partial<AuthenticatedRequest> = {
      headers: { authorization: 'Bearer tok' },
    };
    const guard = new JwtAuthGuard(reflectorWith({}), tokens);
    await expect(guard.canActivate(context(req))).resolves.toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('tok');
    expect(req.user).toBe(alice);
  });
});
