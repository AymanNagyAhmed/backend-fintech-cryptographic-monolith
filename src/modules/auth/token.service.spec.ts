import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'node:crypto';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { JWT_AUDIENCE, JWT_ISSUER } from './auth.types.js';
import { REFRESH_TOKEN_PATTERN, TokenService } from './token.service.js';

const ACCESS_SECRET = 'a'.repeat(32);
const REFRESH_SECRET = 'r'.repeat(32);
const env: Record<string, string> = {
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '7d',
  JWT_REFRESH_SECRET: REFRESH_SECRET,
};
const config = {
  get: (key: string) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

// Same options as AuthModule
const jwtFor = (secret: string, audience = JWT_AUDIENCE) =>
  new JwtService({
    secret,
    signOptions: { algorithm: 'HS256', issuer: JWT_ISSUER, audience },
    verifyOptions: {
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    },
  });

const b64url = (o: object) =>
  Buffer.from(JSON.stringify(o)).toString('base64url');

describe('TokenService', () => {
  const tokens = new TokenService(jwtFor(ACCESS_SECRET), config);
  const verify = (token: string) => tokens.verifyAccessToken(token);

  it('reads the TTLs from the config', () => {
    expect(tokens.accessTtlSeconds).toBe(900);
    expect(tokens.refreshTtlSeconds).toBe(604_800);
    const now = new Date('2026-10-12T00:00:00Z');
    expect(tokens.refreshExpiry(now).toISOString()).toBe(
      '2026-10-19T00:00:00.000Z',
    );
  });

  it('signs an HS256 access token with sub, roles, sid, iss, aud and a 15 minute exp', async () => {
    const token = await tokens.signAccessToken('u1', ['user', 'admin'], 's1');
    const [header, payload] = token
      .split('.')
      .slice(0, 2)
      .map((p) => JSON.parse(Buffer.from(p, 'base64url').toString()));
    expect(header.alg).toBe('HS256');
    expect(payload).toMatchObject({
      sub: 'u1',
      roles: ['user', 'admin'],
      sid: 's1',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
    });
    expect(payload.exp - payload.iat).toBe(900);
    await expect(verify(token)).resolves.toEqual({
      id: 'u1',
      roles: ['user', 'admin'],
      sessionId: 's1',
    });
  });

  it('rejects a token signed with another secret', async () => {
    const forged = await new TokenService(
      jwtFor('x'.repeat(32)),
      config,
    ).signAccessToken('u1', ['admin'], 's1');
    await expect(verify(forged)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token for another audience', async () => {
    const other = await new TokenService(
      jwtFor(ACCESS_SECRET, 'other-api'),
      config,
    ).signAccessToken('u1', ['user'], 's1');
    await expect(verify(other)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects alg "none"', async () => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({
      sub: 'u1',
      roles: ['admin'],
      sid: 's1',
      iss: JWT_ISSUER,
      aud: JWT_AUDIENCE,
      iat: now,
      exp: now + 60,
    })}.`;
    await expect(verify(unsigned)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a changed payload', async () => {
    const [h, , s] = (await tokens.signAccessToken('u1', ['user'], 's1')).split(
      '.',
    );
    const now = Math.floor(Date.now() / 1000);
    const tampered = `${h}.${b64url({ sub: 'u1', roles: ['admin'], sid: 's1', iss: JWT_ISSUER, aud: JWT_AUDIENCE, iat: now, exp: now + 900 })}.${s}`;
    await expect(verify(tampered)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects an expired token', async () => {
    const jwt = jwtFor(ACCESS_SECRET);
    const expired = await jwt.signAsync(
      { roles: ['user'], sid: 's1', iat: Math.floor(Date.now() / 1000) - 120 },
      { subject: 'u1', expiresIn: 60 },
    );
    await expect(verify(expired)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a valid signature with unexpected claims', async () => {
    const jwt = jwtFor(ACCESS_SECRET);
    const odd = await jwt.signAsync(
      { roles: ['superuser'], sid: 's1' },
      { subject: 'u1' },
    );
    await expect(verify(odd)).rejects.toThrow(UnauthorizedException);
  });

  it('creates 256-bit base64url refresh tokens and stores only their HMAC', () => {
    const a = tokens.newRefreshToken();
    const b = tokens.newRefreshToken();
    expect(a.token).toMatch(REFRESH_TOKEN_PATTERN);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(
      createHmac('sha256', REFRESH_SECRET).update(a.token).digest('hex'),
    );
    expect(tokens.hashRefreshToken(a.token)).toBe(a.hash);
  });
});
