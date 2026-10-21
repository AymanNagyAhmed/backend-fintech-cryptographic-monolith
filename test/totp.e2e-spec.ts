import { Controller, Get, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Roles } from '../src/modules/auth/decorators/roles.decorator.js';
import { hotp, totpStep } from '../src/modules/auth/totp/totp.js';

@Controller('totp-test')
class PrivilegedTestController {
  @Get('admin')
  @Roles('admin')
  admin() {
    return { ok: true };
  }
}

const base32Decode = (s: string) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

// Needs the Compose PostgreSQL (`make up`) with the auth migrations applied
describe('TOTP (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const password = 'S3cure!pass-123';
  const http = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  /** A registered, logged-in user (no TOTP yet). */
  const newUser = async () => {
    const email = `e2e-${randomUUID()}@example.com`;
    await http()
      .post('/v1/auth/register')
      .send({ email, password })
      .expect(201);
    const res = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    return { email, access: res.body.data.accessToken as string };
  };

  /** Enrolls TOTP with the current step's code; returns the key to make later codes. */
  const enroll = async (access: string) => {
    const setup = await http()
      .post('/v1/auth/totp/setup')
      .set(bearer(access))
      .expect(200);
    const key = base32Decode(setup.body.data.secret);
    await http()
      .post('/v1/auth/totp/enable')
      .set(bearer(access))
      .send({ code: hotp(key, totpStep()) })
      .expect(200);
    return key;
  };
  // enable consumed the current step, so logins use the next one (inside the drift window)
  const nextCode = (key: Buffer) => hotp(key, totpStep() + 1);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [PrivilegedTestController],
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

  it('setup -> enable, with an otpauth URI and a secret that is encrypted at rest', async () => {
    const { email, access } = await newUser();
    const setup = await http()
      .post('/v1/auth/totp/setup')
      .set(bearer(access))
      .expect(200);
    const { otpauthUri, secret } = setup.body.data;
    expect(otpauthUri).toMatch(
      /^otpauth:\/\/totp\/Fintech:.+\?secret=[A-Z2-7]{32}&issuer=Fintech&algorithm=SHA1&digits=6&period=30$/,
    );

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const cred = await prisma.totpCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(cred.secretEnc).toMatch(/^v1\./);
    expect(cred.secretEnc).not.toContain(secret);
    expect(cred.enabledAt).toBeNull();

    const wrong = await http()
      .post('/v1/auth/totp/enable')
      .set(bearer(access))
      .send({
        code:
          '000000' === hotp(base32Decode(secret), totpStep())
            ? '111111'
            : '000000',
      })
      .expect(422);
    expect(wrong.body.error.code).toBe('INVALID_TOTP');

    await http()
      .post('/v1/auth/totp/enable')
      .set(bearer(access))
      .send({ code: hotp(base32Decode(secret), totpStep()) })
      .expect(200);
    const me = await http().get('/v1/auth/me').set(bearer(access)).expect(200);
    expect(me.body.data.totpEnabled).toBe(true);

    const again = await http()
      .post('/v1/auth/totp/setup')
      .set(bearer(access))
      .expect(409);
    expect(again.body.error.code).toBe('TOTP_ALREADY_ENABLED');
  });

  it('enable without setup is a conflict', async () => {
    const { access } = await newUser();
    const res = await http()
      .post('/v1/auth/totp/enable')
      .set(bearer(access))
      .send({ code: '123456' })
      .expect(409);
    expect(res.body.error.code).toBe('TOTP_NOT_SET_UP');
  });

  it('once enabled, login needs a code, and each code works once', async () => {
    const { email, access } = await newUser();
    const key = await enroll(access);

    const missing = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(401);
    expect(missing.body.error.code).toBe('TOTP_REQUIRED');

    const totpCode = nextCode(key);
    const ok = await http()
      .post('/v1/auth/login')
      .send({ email, password, totpCode })
      .expect(200);
    expect(ok.body.data.mfa).toBe(true);

    const replay = await http()
      .post('/v1/auth/login')
      .send({ email, password, totpCode })
      .expect(401);
    expect(replay.body.error.code).toBe('INVALID_TOTP');
  });

  it('of two concurrent logins with one code, exactly one succeeds', async () => {
    const { email, access } = await newUser();
    const totpCode = nextCode(await enroll(access));
    const results = await Promise.all(
      [1, 2].map(() =>
        http().post('/v1/auth/login').send({ email, password, totpCode }),
      ),
    );
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 401,
    ]);
  });

  it('a privileged role only applies to a session that passed TOTP, also after refresh', async () => {
    const { email, access } = await newUser();
    await prisma.user.update({
      where: { email },
      data: { roles: ['user', 'admin'] },
    });

    // Not enrolled yet: login works, but the admin role is not applied
    const plain = await http()
      .post('/v1/auth/login')
      .send({ email, password })
      .expect(200);
    expect(plain.body.data.mfa).toBe(false);
    const denied = await http()
      .get('/v1/totp-test/admin')
      .set(bearer(plain.body.data.accessToken))
      .expect(403);
    expect(denied.body.error.code).toBe('MFA_REQUIRED');

    const key = await enroll(access);
    const strong = await http()
      .post('/v1/auth/login')
      .send({ email, password, totpCode: nextCode(key) })
      .expect(200);
    await http()
      .get('/v1/totp-test/admin')
      .set(bearer(strong.body.data.accessToken))
      .expect(200);

    const refreshed = await http()
      .post('/v1/auth/refresh')
      .send({ refreshToken: strong.body.data.refreshToken })
      .expect(200);
    expect(refreshed.body.data.mfa).toBe(true);
    await http()
      .get('/v1/totp-test/admin')
      .set(bearer(refreshed.body.data.accessToken))
      .expect(200);
  });

  it('a demoted admin is denied the privileged route but can still list their wallets', async () => {
    const { email, access } = await newUser();
    await prisma.user.update({
      where: { email },
      data: { roles: ['user', 'admin'] },
    });
    const key = await enroll(access);
    const strong = await http()
      .post('/v1/auth/login')
      .send({ email, password, totpCode: nextCode(key) })
      .expect(200);
    const token = strong.body.data.accessToken as string;
    await http().get('/v1/totp-test/admin').set(bearer(token)).expect(200);

    await prisma.user.update({
      where: { email },
      data: { roles: ['user'] },
    });

    const denied = await http()
      .get('/v1/totp-test/admin')
      .set(bearer(token))
      .expect(403);
    expect(denied.body.error.code).toBe('FORBIDDEN');
    await http().get('/v1/wallets').set(bearer(token)).expect(200);
  });

  it('a user without the role gets 403 even with TOTP', async () => {
    const { email, access } = await newUser();
    const key = await enroll(access);
    const res = await http()
      .post('/v1/auth/login')
      .send({ email, password, totpCode: nextCode(key) })
      .expect(200);
    await http()
      .get('/v1/totp-test/admin')
      .set(bearer(res.body.data.accessToken))
      .expect(403);
  });

  it('the database keeps an enabled secret fixed and last_step moving forward', async () => {
    const { email, access } = await newUser();
    await enroll(access);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const cred = await prisma.totpCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    const guard = /enabled secret is fixed and last_step only increases/;
    await expect(
      prisma.totpCredential.update({
        where: { userId: user.id },
        data: { secretEnc: 'v1.a.b.c' },
      }),
    ).rejects.toThrow(guard);
    await expect(
      prisma.totpCredential.update({
        where: { userId: user.id },
        data: { enabledAt: null },
      }),
    ).rejects.toThrow(guard);
    await expect(
      prisma.totpCredential.update({
        where: { userId: user.id },
        data: { lastStep: cred.lastStep! - 1 },
      }),
    ).rejects.toThrow(guard);
  });
});
