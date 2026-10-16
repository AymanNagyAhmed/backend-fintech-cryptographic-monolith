import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { KeyRotationService } from '../src/modules/crypto/key-rotation.service.js';
import { SignerService } from '../src/modules/crypto/signer.service.js';
import { SigningKeysService } from '../src/modules/crypto/signing-keys.service.js';

// Needs Compose OpenBao + PostgreSQL (`make up`) with Transit enabled (A-B1.9) and
// SIGNER_BACKEND=openbao, SIGNING_ALG=ed25519. Creates its own Transit key per run.
describe('Key rotation (e2e)', () => {
  let app: INestApplication<App>;
  let rotation: KeyRotationService;
  let signer: SignerService;
  let keys: SigningKeysService;
  const created: string[] = [];
  const message = new TextEncoder().encode(`checkpoint ${randomUUID()}`);
  const http = () => request(app.getHttpServer());

  const bao = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${process.env.BAO_ADDR}/v1/${path}`, {
      method,
      headers: { 'X-Vault-Token': process.env.BAO_TOKEN ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204)
      throw new Error(`${method} ${path}: HTTP ${res.status}`);
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    rotation = app.get(KeyRotationService);
    signer = app.get(SignerService);
    keys = app.get(SigningKeysService);
  });

  afterAll(async () => {
    for (const name of created) {
      await bao('POST', `transit/keys/${name}/config`, {
        deletion_allowed: true,
      });
      await bao('DELETE', `transit/keys/${name}`);
    }
    await app.close();
  });

  it('after rotate, old and new signatures verify and both public keys are listed', async () => {
    const keyRef = `e2e-rot-${randomUUID().slice(0, 8)}`;
    await bao('POST', `transit/keys/${keyRef}`, { type: 'ed25519' });
    created.push(keyRef);

    const publishedV1 = await rotation.publishMissing(keyRef);
    expect(publishedV1).toMatchObject({
      latestVersion: 1,
      published: [{ keyId: `${keyRef}:v1`, alg: 'ed25519', version: 1 }],
    });

    const v1 = await signer.sign(message, keyRef);
    expect(v1.keyId).toBe(`${keyRef}:v1`);

    const rotated = await rotation.rotate(keyRef);
    expect(rotated).toMatchObject({
      latestVersion: 2,
      published: [{ keyId: `${keyRef}:v2`, alg: 'ed25519', version: 2 }],
    });

    const v2 = await signer.sign(message, keyRef);
    expect(v2.keyId).toBe(`${keyRef}:v2`);
    expect(await signer.verify(message, v1)).toBe(true);
    expect(await signer.verify(message, v2)).toBe(true);

    const res = await http().get('/v1/audit/keys').expect(200);
    const ours = res.body.data.items.filter((k: { keyId: string }) =>
      k.keyId.startsWith(`${keyRef}:`),
    );
    expect(ours.map((k: { keyId: string }) => k.keyId)).toEqual([
      `${keyRef}:v1`,
      `${keyRef}:v2`,
    ]);
  });

  it('rotate publishes every missing version when the catalog was empty', async () => {
    const keyRef = `e2e-rot-${randomUUID().slice(0, 8)}`;
    await bao('POST', `transit/keys/${keyRef}`, { type: 'ed25519' });
    created.push(keyRef);
    const rotated = await rotation.rotate(keyRef);
    expect(rotated.latestVersion).toBe(2);
    expect(rotated.published.map((p) => p.keyId).sort()).toEqual([
      `${keyRef}:v1`,
      `${keyRef}:v2`,
    ]);
  });

  it('after revoke, signatures of that keyId verify false; other versions still verify', async () => {
    const keyRef = `e2e-rot-${randomUUID().slice(0, 8)}`;
    await bao('POST', `transit/keys/${keyRef}`, { type: 'ed25519' });
    created.push(keyRef);

    await rotation.publishMissing(keyRef);
    const v1 = await signer.sign(message, keyRef);
    await rotation.rotate(keyRef);
    const v2 = await signer.sign(message, keyRef);
    expect(await signer.verify(message, v1)).toBe(true);
    expect(await signer.verify(message, v2)).toBe(true);

    const revokedAt = new Date('2026-10-16T20:00:00.000Z');
    await keys.revoke(`${keyRef}:v1`, revokedAt);
    expect(await signer.verify(message, v1)).toBe(false);
    expect(await signer.verify(message, v2)).toBe(true);

    const res = await http().get('/v1/audit/keys').expect(200);
    const ours = res.body.data.items.filter((k: { keyId: string }) =>
      k.keyId.startsWith(`${keyRef}:`),
    );
    expect(ours).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          keyId: `${keyRef}:v1`,
          revokedAt: revokedAt.toISOString(),
        }),
        expect.objectContaining({
          keyId: `${keyRef}:v2`,
          revokedAt: null,
        }),
      ]),
    );
  });
});
