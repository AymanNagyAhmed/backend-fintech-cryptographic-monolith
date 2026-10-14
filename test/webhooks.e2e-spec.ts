import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { signWebhookHeaders } from '../src/modules/payments/webhook-signature.js';

const PATH = '/v1/webhooks/stripe';

// Needs the Compose PostgreSQL and Redis (`make up`) because AppModule connects to both.
describe('Payment webhooks (e2e)', () => {
  let app: INestApplication<App>;
  let secret: string;

  const eventBody = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      data: { walletId: randomUUID(), amount: '250.00', currency: 'AED' },
      ...over,
    });
  const send = (
    body: string,
    headers: Record<string, string>,
    path = PATH,
    contentType = 'application/json',
  ) =>
    request(app.getHttpServer())
      .post(path)
      .set(headers)
      .set('Content-Type', contentType)
      .send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      // Limits are covered by rate-limit.e2e-spec.ts
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    // rawBody as in main.ts: the signature is over the exact bytes sent
    app = moduleRef.createNestApplication<INestApplication<App>>({
      rawBody: true,
      logger: false,
    });
    setupApp(app);
    await app.init();
    secret = app
      .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
      .get('WEBHOOK_SECRET_STRIPE', { infer: true });
  });

  afterAll(() => app.close());

  it('answers 200 with a receipt for a signed event, without a Bearer token', async () => {
    const body = eventBody();
    const res = await send(body, signWebhookHeaders(secret, body)).expect(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Webhook received',
      data: {
        provider: 'stripe',
        eventId: JSON.parse(body).id,
        type: 'payment.succeeded',
        status: 'received',
      },
    });
  });

  it('answers 200 again when the same signed request is redelivered', async () => {
    const body = eventBody();
    const headers = signWebhookHeaders(secret, body);
    const first = await send(body, headers).expect(200);
    const again = await send(body, headers).expect(200);
    expect(again.body.data).toEqual(first.body.data);
  });

  it('allows provider fields the service does not read', async () => {
    const body = eventBody({ object: 'event', livemode: false, created: 1 });
    await send(body, signWebhookHeaders(secret, body)).expect(200);
  });

  it('checks the signature over the exact bytes, not the parsed JSON', async () => {
    const body = eventBody();
    const headers = signWebhookHeaders(secret, body);
    // Same JSON value, different bytes
    const pretty = JSON.stringify(JSON.parse(body), null, 2);
    const res = await send(pretty, headers).expect(400);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it.each([
    ['a changed amount', (b: string) => b.replace('250.00', '25000.00')],
    ['a trailing space', (b: string) => `${b} `],
  ])('answers 400 INVALID_WEBHOOK_SIGNATURE for %s', async (_, change) => {
    const body = eventBody();
    const res = await send(change(body), signWebhookHeaders(secret, body));
    expect([res.status, res.body.error.code]).toEqual([
      400,
      'INVALID_WEBHOOK_SIGNATURE',
    ]);
  });

  it('answers 400 for another secret', async () => {
    const body = eventBody();
    const res = await send(body, signWebhookHeaders(`${secret}x`, body));
    expect([res.status, res.body.error.code]).toEqual([
      400,
      'INVALID_WEBHOOK_SIGNATURE',
    ]);
  });

  it.each([301, -301])(
    'answers 400 WEBHOOK_TIMESTAMP_EXPIRED %i seconds off',
    async (offset) => {
      const body = eventBody();
      const ts = String(Math.floor(Date.now() / 1000) - offset);
      const res = await send(body, signWebhookHeaders(secret, body, ts));
      expect([res.status, res.body.error.code]).toEqual([
        400,
        'WEBHOOK_TIMESTAMP_EXPIRED',
      ]);
    },
  );

  it('answers 200 at 290 seconds off', async () => {
    const body = eventBody();
    const ts = String(Math.floor(Date.now() / 1000) - 290);
    await send(body, signWebhookHeaders(secret, body, ts)).expect(200);
  });

  it.each(['x-timestamp', 'x-signature'])(
    'answers 400 WEBHOOK_SIGNATURE_HEADERS_INVALID without %s',
    async (missing) => {
      const body = eventBody();
      const headers = signWebhookHeaders(secret, body);
      delete (headers as Record<string, string>)[missing];
      const res = await send(body, headers).expect(400);
      expect(res.body.error).toMatchObject({
        code: 'WEBHOOK_SIGNATURE_HEADERS_INVALID',
        details: [{ field: missing, issue: 'missing or malformed' }],
      });
    },
  );

  it('checks the signature before the event fields', async () => {
    const res = await send('{"junk":true}', {
      'x-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-signature': '0'.repeat(64),
    }).expect(400);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('answers 400 INVALID_WEBHOOK_EVENT for a signed event without the needed fields', async () => {
    const body = JSON.stringify({ id: 'evt 1', type: 'payment.succeeded' });
    const res = await send(body, signWebhookHeaders(secret, body)).expect(400);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_EVENT');
    expect(
      res.body.error.details.map((d: { field: string }) => d.field),
    ).toEqual(['id', 'data']);
  });

  it('answers 400 for a non-JSON body signed as sent', async () => {
    const body = 'id=evt_1';
    const res = await send(
      body,
      signWebhookHeaders(secret, body),
      PATH,
      'text/plain',
    ).expect(400);
    // No parsed body, so no raw body either: the signature cannot match
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
  });

  it('answers 404 WEBHOOK_PROVIDER_NOT_FOUND for an unknown provider', async () => {
    const body = eventBody();
    const res = await send(
      body,
      signWebhookHeaders(secret, body),
      '/v1/webhooks/paypal',
    ).expect(404);
    expect(res.body.error.code).toBe('WEBHOOK_PROVIDER_NOT_FOUND');
  });
});
