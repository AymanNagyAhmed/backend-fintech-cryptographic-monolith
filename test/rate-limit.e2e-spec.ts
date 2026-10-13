import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Express } from 'express';
import { randomInt, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { RedisThrottlerStorage } from '../src/common/throttler/redis-throttler.storage.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { RATE_LIMITS } from '../src/config/throttler.config.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Counters live in Redis across runs, so every test uses its own client IP and email
const randomIp = () =>
  `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

// Needs the Compose Redis and PostgreSQL (`make up`)
describe('Rate limiting (e2e)', () => {
  let app: INestApplication<App>;
  let storage: RedisThrottlerStorage;
  const password = 'S3cure!pass-123';

  const createApp = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const instance = moduleRef.createNestApplication<INestApplication<App>>({
      logger: false,
    });
    setupApp(instance);
    // The test client is the "proxy": X-Forwarded-For sets the client IP
    const express: Express = instance.getHttpAdapter().getInstance();
    express.set('trust proxy', 'loopback');
    await instance.init();
    return instance;
  };
  const login = (target: INestApplication<App>, ip: string, email: string) =>
    request(target.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });

  beforeAll(async () => {
    app = await createApp();
    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    storage = RedisThrottlerStorage.fromUrl(
      config.get('REDIS_URL', { infer: true }),
    );
  });

  afterAll(async () => {
    await storage.onModuleDestroy();
    await app.close();
  });

  describe('Redis storage', () => {
    it('counts up to the limit, then blocks for blockDuration and starts a new window', async () => {
      const key = randomUUID();
      for (let i = 1; i <= 3; i++) {
        const hit = await storage.increment(key, 60_000, 3, 1_000, 'test');
        expect(hit).toMatchObject({
          totalHits: i,
          isBlocked: false,
          timeToExpire: 60,
        });
      }
      const blocked = await storage.increment(key, 60_000, 3, 1_000, 'test');
      expect(blocked).toMatchObject({
        totalHits: 4,
        isBlocked: true,
        timeToBlockExpire: 1,
      });
      expect(
        (await storage.increment(key, 60_000, 3, 1_000, 'test')).isBlocked,
      ).toBe(true);

      await sleep(1_100);
      expect(
        await storage.increment(key, 60_000, 3, 1_000, 'test'),
      ).toMatchObject({
        totalHits: 1,
        isBlocked: false,
      });
    });

    it('starts a new window after ttl', async () => {
      const key = randomUUID();
      await storage.increment(key, 300, 5, 300, 'test');
      await storage.increment(key, 300, 5, 300, 'test');
      await sleep(400);
      expect(
        (await storage.increment(key, 300, 5, 300, 'test')).totalHits,
      ).toBe(1);
    });

    it('lets exactly `limit` of many concurrent hits through', async () => {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          storage.increment(key, 60_000, 10, 60_000, 'test'),
        ),
      );
      expect(results.filter((r) => !r.isBlocked)).toHaveLength(10);
    });
  });

  describe('HTTP', () => {
    it('login: limited per IP, 429 in the envelope with Retry-After', async () => {
      const ip = randomIp();
      const { limit } = RATE_LIMITS.login;
      for (let i = 0; i < limit; i++) {
        const res = await login(
          app,
          ip,
          `e2e-${randomUUID()}@example.com`,
        ).expect(401);
        expect(res.headers['x-ratelimit-limit']).toBe(String(limit));
        expect(res.headers['x-ratelimit-remaining']).toBe(
          String(limit - i - 1),
        );
      }
      const res = await login(
        app,
        ip,
        `e2e-${randomUUID()}@example.com`,
      ).expect(429);
      expect(res.body).toMatchObject({
        success: false,
        statusCode: 429,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests. Please retry later.',
        },
      });
      expect(res.body.meta.requestId).toBeTruthy();
      expect(Number(res.headers['retry-after'])).toBe(
        RATE_LIMITS.login.blockDuration / 1000,
      );

      // Another IP is not affected
      await login(app, randomIp(), `e2e-${randomUUID()}@example.com`).expect(
        401,
      );
    });

    it('login: limited per account across IPs', async () => {
      const email = `e2e-${randomUUID()}@example.com`;
      for (let i = 0; i < RATE_LIMITS.account.limit; i++) {
        await login(
          app,
          randomIp(),
          i % 2 ? email.toUpperCase() : email,
        ).expect(401);
      }
      const res = await login(app, randomIp(), email).expect(429);
      expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
      expect(Number(res.headers['retry-after-account'])).toBe(
        RATE_LIMITS.account.blockDuration / 1000,
      );
    });

    it('a correct password does not get through a blocked account', async () => {
      const email = `e2e-${randomUUID()}@example.com`;
      await request(app.getHttpServer())
        .post('/v1/auth/register')
        .set('X-Forwarded-For', randomIp())
        .send({ email, password })
        .expect(201);
      for (let i = 0; i < RATE_LIMITS.account.limit; i++) {
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .set('X-Forwarded-For', randomIp())
          .send({ email, password: 'wrong-password-1' })
          .expect(401);
      }
      await login(app, randomIp(), email).expect(429);
    });

    it('runs before authentication, so unauthenticated floods are limited too', async () => {
      const ip = randomIp();
      for (let i = 0; i < RATE_LIMITS.totp.limit; i++) {
        await request(app.getHttpServer())
          .post('/v1/auth/totp/enable')
          .set('X-Forwarded-For', ip)
          .send({ code: '123456' })
          .expect(401);
      }
      await request(app.getHttpServer())
        .post('/v1/auth/totp/enable')
        .set('X-Forwarded-For', ip)
        .send({ code: '123456' })
        .expect(429);
    });

    it('does not limit health probes', async () => {
      const ip = randomIp();
      for (let i = 0; i < RATE_LIMITS.default.limit + 5; i++) {
        const res = await request(app.getHttpServer())
          .get('/v1/health/live')
          .set('X-Forwarded-For', ip)
          .expect(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
      }
    });

    it('a block survives an app restart (state is in Redis)', async () => {
      const ip = randomIp();
      for (let i = 0; i <= RATE_LIMITS.login.limit; i++) {
        await login(app, ip, `e2e-${randomUUID()}@example.com`);
      }
      const restarted = await createApp();
      try {
        await login(restarted, ip, `e2e-${randomUUID()}@example.com`).expect(
          429,
        );
      } finally {
        await restarted.close();
      }
    });
  });
});
