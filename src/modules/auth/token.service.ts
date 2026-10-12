import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomBytes } from 'node:crypto';
import { durationToSeconds } from '../../common/duration.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import {
  ROLES,
  type AccessTokenClaims,
  type AuthUser,
  type Role,
} from './auth.types.js';

const REFRESH_TOKEN_BYTES = 32;
export const REFRESH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const isClaims = (
  c: Record<string, unknown>,
): c is Record<string, unknown> & AccessTokenClaims =>
  typeof c.sub === 'string' &&
  typeof c.sid === 'string' &&
  typeof c.mfa === 'boolean' &&
  Array.isArray(c.roles) &&
  c.roles.every((r) => ROLES.includes(r as Role));

@Injectable()
export class TokenService {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  private readonly refreshKey: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.accessTtlSeconds = durationToSeconds(
      config.get('JWT_ACCESS_TTL', { infer: true }),
    );
    this.refreshTtlSeconds = durationToSeconds(
      config.get('JWT_REFRESH_TTL', { infer: true }),
    );
    this.refreshKey = config.get('JWT_REFRESH_SECRET', { infer: true });
  }

  /** HS256 with JWT_ACCESS_SECRET; issuer, audience and algorithm are set in AuthModule. */
  signAccessToken(
    userId: string,
    roles: Role[],
    sessionId: string,
    mfa: boolean,
  ) {
    return this.jwt.signAsync(
      { roles, sid: sessionId, mfa },
      { subject: userId, expiresIn: this.accessTtlSeconds },
    );
  }

  async verifyAccessToken(token: string): Promise<AuthUser> {
    let claims: Record<string, unknown>;
    try {
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
    if (!isClaims(claims))
      throw new UnauthorizedException('Invalid or expired access token');
    return {
      id: claims.sub,
      roles: claims.roles,
      sessionId: claims.sid,
      mfa: claims.mfa,
    };
  }

  /** 256-bit opaque token for the client, and the only value stored in auth.refresh_tokens. */
  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
    return { token, hash: this.hashRefreshToken(token) };
  }

  hashRefreshToken(token: string): string {
    return createHmac('sha256', this.refreshKey).update(token).digest('hex');
  }

  refreshExpiry(now = new Date()): Date {
    return new Date(now.getTime() + this.refreshTtlSeconds * 1000);
  }
}
