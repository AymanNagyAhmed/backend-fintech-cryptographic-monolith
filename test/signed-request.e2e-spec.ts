import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { generateKeyPairSync, randomUUID, type KeyObject } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import {
  NONCE_TTL_SEC,
  signRequestHeaders,
} from '../src/common/request-signing/canonical-request.js';
import { NONCE_KEY_PREFIX } from '../src/common/request-signing/nonce.store.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ApiClientsService } from '../src/modules/auth/api-clients/api-clients.service.js';

const PATH = '/v1/b2b/ping';

// Needs the Compose PostgreSQL (with the api_clients migration) and Redis (`make up`).
// Every run creates its own clients (app_writer cannot DELETE) and nonces.
describe('Signed requests (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let redis: Redis;
  let hmac: { clientId: string; secret: string };
  let ed: { clientId: string; privateKey: KeyObject };

  const createApp = async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Limits are covered by rate-limit.e2e-spec.ts
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    // rawBody as in main.ts: the body hash is over the exact bytes sent
    const instance = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
      logger: false,
    });
    setupApp(instance);
    await instance.init();
    return instance;
  };
  const newClientId = () => `e2e-${randomUUID()}`;

  const sign = (
    body: string,
    over: {
      timestamp?: string;
      nonce?: string;
      clientId?: string;
      key?: string | KeyObject;
    } = {},
  ) =>
    signRequestHeaders({
      clientId: hmac.clientId,
      key: hmac.secret,
      method: 'POST',
      path: PATH,
      body,
      ...over,
    });
  const send = (
    target: INestApplication<App>,
    headers: Record<string, string>,
    body: string,
  ) =>
    request(target.getHttpServer())
      .post(PATH)
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(body);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const config =
      app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
    redis = new Redis(config.get('REDIS_URL', { infer: true }));

    const clients = app.get(ApiClientsService);
    const created = await clients.create({
      clientId: newClientId(),
      name: 'E2E HMAC',
      algorithm: 'hmac_sha256',
    });
    hmac = { clientId: created.clientId, secret: created.secret! };
    const keys = generateKeyPairSync('ed25519');
    const edClient = await clients.create({
      clientId: newClientId(),
      name: 'E2E Ed25519',
      algorithm: 'ed25519',
      publicKey: keys.publicKey,
    });
    ed = { clientId: edClient.clientId, privateKey: keys.privateKey };
  });

  afterAll(async () => {
    redis.disconnect();
    await app.close();
  });

  it('accepts an HMAC-signed request and names the client', async () => {
    const body = JSON.stringify({ message: 'hello' });
    const res = await send(app, sign(body), body).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      message: 'Signature verified',
      data: { clientId: hmac.clientId, message: 'hello' },
    });
  });

  it('accepts an Ed25519-signed request', async () => {
    const body = '{}';
    const headers = sign(body, { clientId: ed.clientId, key: ed.privateKey });
    const res = await send(app, headers, body).expect(200);
    expect(res.body.data.clientId).toBe(ed.clientId);
  });

  it('2.13 step 1: the same request sent again is rejected (nonce used)', async () => {
    const body = JSON.stringify({ message: 'pay once' });
    const headers = sign(body);
    await send(app, headers, body).expect(200);
    const replay = await send(app, headers, body).expect(401);
    expect(replay.body.error.code).toBe('NONCE_REUSED');

    // The nonce is stored per client in Redis with a TTL that outlives the time window
    const ttl = await redis.ttl(
      `${NONCE_KEY_PREFIX}${hmac.clientId}:${headers['x-nonce']}`,
    );
    expect(ttl).toBeGreaterThan(NONCE_TTL_SEC - 10);
    expect(ttl).toBeLessThanOrEqual(NONCE_TTL_SEC);
  });

  it('2.13 step 2: a request signed 6 minutes ago is rejected (timestamp too old)', async () => {
    const body = '{}';
    const sixMinutesAgo = String(Math.floor(Date.now() / 1000) - 360);
    const res = await send(
      app,
      sign(body, { timestamp: sixMinutesAgo }),
      body,
    ).expect(401);
    expect(res.body.error.code).toBe('REQUEST_EXPIRED');
  });

  it('2.13 step 3: one changed body byte with the old signature is rejected', async () => {
    const body = JSON.stringify({ message: 'amount 100' });
    const headers = sign(body);
    const tampered = body.replace('100', '900');
    const res = await send(app, headers, tampered).expect(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    // The rejected attempt did not burn the nonce: the genuine request still passes
    await send(app, headers, body).expect(200);
  });

  it('2.13 step 4: after an app restart the replay is still rejected (nonces in Redis)', async () => {
    const body = JSON.stringify({ message: 'before restart' });
    const headers = sign(body);
    await send(app, headers, body).expect(200);

    const restarted = await createApp();
    try {
      const res = await send(restarted, headers, body).expect(401);
      expect(res.body.error.code).toBe('NONCE_REUSED');
    } finally {
      await restarted.close();
    }
  });

  it('rejects a signed path with another query string, and missing headers', async () => {
    const body = '{}';
    const headers = sign(body);
    const moved = await request(app.getHttpServer())
      .post(`${PATH}?amount=900`)
      .set(headers)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(401);
    expect(moved.body.error.code).toBe('INVALID_SIGNATURE');

    const bare = await send(app, {}, body).expect(401);
    expect(bare.body.error).toMatchObject({
      code: 'SIGNATURE_HEADERS_INVALID',
      details: [{ field: 'x-client-id', issue: 'missing or malformed' }],
    });
  });

  it('a Bearer token is not a substitute for a signature', async () => {
    const res = await request(app.getHttpServer())
      .post(PATH)
      .set('Authorization', 'Bearer anything')
      .send({})
      .expect(401);
    expect(res.body.error.code).toBe('SIGNATURE_HEADERS_INVALID');
  });

  it('a revoked client is rejected like an unknown one', async () => {
    const clients = app.get(ApiClientsService);
    const created = await clients.create({
      clientId: newClientId(),
      name: 'E2E revoked',
      algorithm: 'hmac_sha256',
    });
    const body = '{}';
    const own = { clientId: created.clientId, key: created.secret! };
    await send(app, sign(body, own), body).expect(200);
    await clients.revoke(created.clientId);
    const res = await send(app, sign(body, own), body).expect(401);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
  });

  describe('auth.api_clients rules in the database', () => {
    it('key material must match the algorithm', async () => {
      await expect(
        prisma.apiClient.create({
          data: {
            clientId: newClientId(),
            name: 'bad',
            algorithm: 'hmac_sha256',
            publicKey: 'A'.repeat(43),
          },
        }),
      ).rejects.toThrow(/api_clients_key_chk/);
    });

    it('the key is fixed and revoked_at is set once', async () => {
      const guard = /identity and key are fixed; revoked_at may be set once/;
      await expect(
        prisma.apiClient.update({
          where: { clientId: ed.clientId },
          data: { publicKey: 'B'.repeat(43) },
        }),
      ).rejects.toThrow(guard);

      const row = await prisma.apiClient.create({
        data: {
          clientId: newClientId(),
          name: 'r',
          algorithm: 'ed25519',
          publicKey: 'C'.repeat(43),
        },
      });
      await prisma.apiClient.update({
        where: { id: row.id },
        data: { revokedAt: new Date() },
      });
      await expect(
        prisma.apiClient.update({
          where: { id: row.id },
          data: { revokedAt: null },
        }),
      ).rejects.toThrow(guard);
    });

    it('app_writer cannot delete clients', async () => {
      await expect(
        prisma.apiClient.delete({ where: { clientId: ed.clientId } }),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
