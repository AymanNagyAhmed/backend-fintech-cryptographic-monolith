import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';

// Needs the Compose PostgreSQL (`make up`) with the auth migrations applied.
// app_writer cannot DELETE, so every run uses fresh emails and leaves its rows behind.
describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'S3cure!pass-123';
  const http = () => request(app.getHttpServer());

  const register = async () => {
    const email = `e2e-${randomUUID()}@example.com`;
    await http()
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    return email;
  };
  const login = async (email: string) =>
    (await http().post('/v1/auth/login').send({ email, password }).expect(200))
      .body.data as { accessToken: string; refreshToken: string };
  const refresh = (refreshToken: string) =>
    http().post('/v1/auth/refresh').send({ refreshToken });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Every request comes from 127.0.0.1; limits are covered by rate-limit.e2e-spec.ts
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('register -> login -> me', async () => {
    const email = await register();
    const res = await http()
      .post('/v1/auth/login')
      .send({ email: email.toUpperCase(), password })
      .expect(200);
    expect(res.body.data).toMatchObject({
      tokenType: 'Bearer',
      expiresIn: 900,
    });

    const me = await http()
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .expect(200);
    expect(me.body.data).toMatchObject({
      email,
      roles: ['user'],
      status: 'active',
    });
    expect(me.body.data).not.toHaveProperty('passwordHash');
  });

  it('register returns the profile, rejects a weak password and a taken email', async () => {
    const email = `e2e-${randomUUID()}@example.com`;
    const res = await http()
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    expect(res.body.data).toMatchObject({ email, roles: ['user'] });

    const weak = await http()
      .post('/v1/auth/register')
      .send({ email: `x-${email}`, password: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(weak.body)).not.toContain('short');

    const taken = await http()
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(409);
    expect(taken.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('a self-registration cannot pick its roles', async () => {
    const res = await http()
      .post('/v1/auth/register')
      .send({
        email: `e2e-${randomUUID()}@example.com`,
        password,
        roles: ['admin'],
      })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('wrong password and unknown email give the same 401', async () => {
    const email = await register();
    const wrong = await http()
      .post('/v1/auth/login')
      .send({ email, password: 'not-the-password' })
      .expect(401);
    const unknown = await http()
      .post('/v1/auth/login')
      .send({ email: `nobody-${randomUUID()}@example.com`, password })
      .expect(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('protected routes need a valid bearer token; health stays public', async () => {
    const missing = await http().get('/v1/auth/me').expect(401);
    expect(missing.body.error.code).toBe('UNAUTHORIZED');
    await http()
      .get('/v1/auth/me')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
    await http().get('/v1/health/live').expect(200);
  });

  it('refresh rotates the token; the old one is single use', async () => {
    const first = await login(await register());
    const second = (await refresh(first.refreshToken).expect(200)).body.data;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    await http()
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${second.accessToken}`)
      .expect(200);
    const third = (await refresh(second.refreshToken).expect(200)).body.data;
    expect(third.refreshToken).not.toBe(second.refreshToken);
  });

  it('a reused refresh token is rejected and revokes the whole session family', async () => {
    const first = await login(await register());
    const second = (await refresh(first.refreshToken).expect(200)).body.data;

    const reuse = await refresh(first.refreshToken).expect(401);
    expect(reuse.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    // The legitimate latest token is revoked too: the session must log in again
    const after = await refresh(second.refreshToken).expect(401);
    expect(after.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('of two concurrent refreshes with one token, exactly one succeeds', async () => {
    const { refreshToken } = await login(await register());
    const results = await Promise.all([
      refresh(refreshToken),
      refresh(refreshToken),
    ]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
    const winner = results.find((r) => r.status === 200)!.body.data;
    // The loser counts as reuse, so the winner's new token is revoked as well
    await refresh(winner.refreshToken).expect(401);
  });

  it('logout revokes the session; unknown tokens still get 200', async () => {
    const { refreshToken } = await login(await register());
    await http().post('/v1/auth/logout').send({ refreshToken }).expect(200);
    const res = await refresh(refreshToken).expect(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
    await http()
      .post('/v1/auth/logout')
      .send({ refreshToken: 'A'.repeat(43) })
      .expect(200);
  });

  it('a malformed refresh token is a validation error', async () => {
    const res = await refresh('short').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('a locked account cannot log in or refresh', async () => {
    const email = await register();
    const { refreshToken } = await login(email);
    await prisma.user.update({ where: { email }, data: { status: 'locked' } });

    const loginRes = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(403);
    expect(loginRes.body.error.code).toBe('ACCOUNT_INACTIVE');
    await refresh(refreshToken).expect(403);
  });

  it('stores only the HMAC of refresh tokens, and the database refuses to re-enable one', async () => {
    const email = await register();
    const { refreshToken } = await login(email);
    await http().post('/v1/auth/logout').send({ refreshToken }).expect(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const [row] = await prisma.refreshToken.findMany({
      where: { userId: user.id },
    });
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(refreshToken);
    expect(row.revokedAt).not.toBeNull();

    await expect(
      prisma.refreshToken.update({
        where: { id: row.id },
        data: { revokedAt: null },
      }),
    ).rejects.toThrow(/only used_at and revoked_at may be set, once/);
  });
});
