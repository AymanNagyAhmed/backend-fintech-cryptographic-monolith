import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import { UserStatus } from '../../generated/prisma/client.js';
import { UsersService, type UserView } from '../users/users.service.js';
import type { Role } from './auth.types.js';
import type { LoginDto, RegisterDto } from './dto/auth.dto.js';
import type { TokenPairDto, UserProfileDto } from './dto/auth-response.dto.js';
import { TokenService } from './token.service.js';

type RefreshOutcome =
  | { kind: 'rotated'; userId: string; familyId: string; refreshToken: string }
  | { kind: 'reused' }
  | { kind: 'invalid' };

const invalidCredentials = () =>
  new DomainException(
    'INVALID_CREDENTIALS',
    'Email or password is incorrect.',
    HttpStatus.UNAUTHORIZED,
  );
const invalidRefreshToken = () =>
  new DomainException(
    'INVALID_REFRESH_TOKEN',
    'Refresh token is invalid, expired or revoked.',
    HttpStatus.UNAUTHORIZED,
  );
const accountInactive = () =>
  new DomainException(
    'ACCOUNT_INACTIVE',
    'This account is locked or disabled.',
    HttpStatus.FORBIDDEN,
  );

export const toProfile = (user: UserView): UserProfileDto => ({
  id: user.id,
  email: user.email,
  roles: user.roles,
  status: user.status,
  createdAt: user.createdAt.toISOString(),
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  /** Self-registration always creates a plain `user`; other roles are granted by an admin. */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    return toProfile(
      await this.users.create({ email: dto.email, password: dto.password }),
    );
  }

  async login(dto: LoginDto): Promise<TokenPairDto> {
    const user = await this.users.verifyCredentials(dto.email, dto.password);
    if (!user) throw invalidCredentials();
    // Only after the password matched, so this is not an account-existence oracle
    if (user.status !== UserStatus.active) throw accountInactive();

    const familyId = randomUUID();
    const { token, hash } = this.tokens.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hash,
        expiresAt: this.tokens.refreshExpiry(),
      },
    });
    return this.pair(user.id, user.roles, familyId, token);
  }

  /**
   * Rotates a refresh token: the presented one is marked used and a new one in the same family
   * is returned. Presenting a token that was already used means it leaked (or two clients
   * share it), so the whole family is revoked and the session must log in again.
   */
  async refresh(refreshToken: string): Promise<TokenPairDto> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    // The outcome is returned, not thrown: a throw would roll back the family revocation
    const outcome = await this.prisma.withTx<RefreshOutcome>(async (tx) => {
      const now = new Date();
      // Atomic claim: of two concurrent refreshes with one token, only one matches
      const claimed = await tx.refreshToken.updateMany({
        where: {
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      const row = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!row) return { kind: 'invalid' };
      if (claimed.count === 0) {
        if (!row.usedAt) return { kind: 'invalid' }; // expired or revoked by logout
        await tx.refreshToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
        return { kind: 'reused' };
      }
      const next = this.tokens.newRefreshToken();
      await tx.refreshToken.create({
        data: {
          userId: row.userId,
          familyId: row.familyId,
          tokenHash: next.hash,
          expiresAt: this.tokens.refreshExpiry(now),
        },
      });
      return {
        kind: 'rotated',
        userId: row.userId,
        familyId: row.familyId,
        refreshToken: next.token,
      };
    });

    if (outcome.kind === 'reused') {
      this.logger.warn('Refresh token reuse detected; session family revoked');
      throw new DomainException(
        'REFRESH_TOKEN_REUSED',
        'Refresh token was already used; the session has been revoked.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    if (outcome.kind === 'invalid') throw invalidRefreshToken();

    // Roles and status are read again, so changes apply at the next refresh at the latest
    const user = await this.users.findById(outcome.userId);
    if (!user || user.status !== UserStatus.active) {
      await this.revokeFamily(outcome.familyId);
      throw accountInactive();
    }
    return this.pair(
      user.id,
      user.roles,
      outcome.familyId,
      outcome.refreshToken,
    );
  }

  /** Revokes the session of the given refresh token. Unknown tokens are ignored (no oracle). */
  async logout(refreshToken: string): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken) },
    });
    if (row) await this.revokeFamily(row.familyId);
  }

  async me(userId: string): Promise<UserProfileDto> {
    const user = await this.users.findById(userId);
    if (!user)
      throw new DomainException(
        'UNAUTHORIZED',
        'User no longer exists.',
        HttpStatus.UNAUTHORIZED,
      );
    return toProfile(user);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async pair(
    userId: string,
    roles: Role[],
    familyId: string,
    refreshToken: string,
  ): Promise<TokenPairDto> {
    return {
      accessToken: await this.tokens.signAccessToken(userId, roles, familyId),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }
}
