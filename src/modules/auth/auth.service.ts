import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MetricsService } from '../../common/metrics/metrics.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import { UserStatus } from '../../generated/prisma/client.js';
import { UsersService, type UserView } from '../users/users.service.js';
import type { Role } from './auth.types.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { TokenPairDto } from './dto/token-pair.dto.js';
import type { UserProfileDto } from './dto/user-profile.dto.js';
import {
  accountInactive,
  invalidCredentials,
  invalidRefreshToken,
  invalidTotp,
  refreshTokenReused,
  totpRequired,
  userGone,
} from './exceptions/auth.exceptions.js';
import { TokenService } from './token.service.js';
import { TotpService } from './totp/totp.service.js';

type RefreshOutcome =
  | {
      kind: 'rotated';
      userId: string;
      familyId: string;
      mfa: boolean;
      refreshToken: string;
    }
  | { kind: 'reused' }
  | { kind: 'invalid' };

export const toProfile = (
  user: UserView,
  totpEnabled: boolean,
): UserProfileDto => ({
  id: user.id,
  email: user.email,
  roles: user.roles,
  status: user.status,
  totpEnabled,
  createdAt: user.createdAt.toISOString(),
});

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /** Self-registration always creates a plain `user`; other roles are granted by an admin. */
  async register(dto: RegisterDto): Promise<UserProfileDto> {
    const user = await this.users.create({
      email: dto.email,
      password: dto.password,
    });
    return toProfile(user, false);
  }

  /**
   * Password, then TOTP when enabled. A session without TOTP gets tokens with `mfa: false`,
   * in which privileged roles are not applied (RolesGuard), so such a user can still enroll.
   */
  async login(dto: LoginDto): Promise<TokenPairDto> {
    const user = await this.users.verifyCredentials(dto.email, dto.password);
    if (!user) throw invalidCredentials();
    // Only after the password matched, so these are not account-existence oracles
    if (user.status !== UserStatus.active) throw accountInactive();
    const mfa = await this.totp.isEnabled(user.id);
    if (mfa) {
      if (!dto.totpCode) throw totpRequired();
      if (!(await this.totp.verify(user.id, dto.totpCode))) throw invalidTotp();
    }

    const familyId = randomUUID();
    const { token, hash } = this.tokens.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hash,
        mfa,
        expiresAt: this.tokens.refreshExpiry(),
      },
    });
    return this.pair(user.id, user.roles, familyId, mfa, token);
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
          mfa: row.mfa,
          expiresAt: this.tokens.refreshExpiry(now),
        },
      });
      return {
        kind: 'rotated',
        userId: row.userId,
        familyId: row.familyId,
        mfa: row.mfa,
        refreshToken: next.token,
      };
    });

    if (outcome.kind === 'reused') {
      this.metrics?.recordRefreshReuse();
      this.logger.warn('Refresh token reuse detected; session family revoked');
      throw refreshTokenReused();
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
      outcome.mfa,
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
    if (!user) throw userGone();
    return toProfile(user, await this.totp.isEnabled(user.id));
  }

  async setupTotp(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw userGone();
    return this.totp.setup(user.id, user.email);
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
    mfa: boolean,
    refreshToken: string,
  ): Promise<TokenPairDto> {
    return {
      accessToken: await this.tokens.signAccessToken(
        userId,
        roles,
        familyId,
        mfa,
      ),
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.tokens.accessTtlSeconds,
      mfa,
    };
  }
}
