import type { MetricsService } from '../../common/metrics/metrics.service.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { UsersService } from '../users/users.service.js';
import { AuthService } from './auth.service.js';
import type { TokenService } from './token.service.js';
import type { TotpService } from './totp/totp.service.js';

describe('AuthService.refresh', () => {
  it('counts a replayed refresh token when the family is revoked', async () => {
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });
    const tx = {
      refreshToken: {
        updateMany,
        findUnique: vi.fn().mockResolvedValue({
          usedAt: new Date('2026-10-21T12:00:00Z'),
          familyId: 'fam-1',
        }),
      },
    };
    const recordRefreshReuse = vi.fn();
    const service = new AuthService(
      {
        withTx: async (work: (client: typeof tx) => unknown) => work(tx),
      } as unknown as PrismaService,
      {} as UsersService,
      { hashRefreshToken: () => 'hash' } as unknown as TokenService,
      {} as TotpService,
      { recordRefreshReuse } as unknown as MetricsService,
    );

    await expect(service.refresh('stolen')).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
      statusCode: 401,
    });
    expect(recordRefreshReuse).toHaveBeenCalledOnce();
    expect(updateMany).toHaveBeenLastCalledWith({
      where: { familyId: 'fam-1', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
  });
});
