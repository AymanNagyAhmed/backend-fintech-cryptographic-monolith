import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { setupApp } from '../src/app.setup.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { encodePublicKey } from '../src/modules/crypto/public-key.js';
import { SigningKeysService } from '../src/modules/crypto/signing-keys.service.js';

// Needs Compose PostgreSQL (`make up`) with the CreateSigningKeys migration applied.
describe('GET /v1/audit/keys (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let keys: SigningKeysService;
  const http = () => request(app.getHttpServer());
  // Unique key names so parallel or repeated runs never collide (no DELETE for app_writer)
  const keyRef = () => `e2e-keys-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    keys = app.get(SigningKeysService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists published public keys without auth, including revoked ones', async () => {
    const ref = keyRef();
    const ed = generateKeyPairSync('ed25519');
    const pq = generateKeyPairSync('ml-dsa-65');
    const v1 = await keys.activate({
      keyId: `${ref}:v1`,
      alg: 'ed25519',
      publicKey: encodePublicKey(ed.publicKey),
      activatedAt: new Date('2026-10-16T10:00:00.000Z'),
    });
    const v2 = await keys.activate({
      keyId: `${ref}:v2`,
      alg: 'ml-dsa-65',
      publicKey: encodePublicKey(pq.publicKey),
      activatedAt: new Date('2026-10-16T11:00:00.000Z'),
    });
    await keys.revoke(v1.keyId, new Date('2026-10-16T12:00:00.000Z'));

    const res = await http().get('/v1/audit/keys').expect(200);
    expect(res.body).toMatchObject({
      success: true,
      statusCode: 200,
      message: 'Signing keys',
    });
    const ours = res.body.data.items.filter((k: { keyId: string }) =>
      k.keyId.startsWith(`${ref}:`),
    );
    expect(ours).toEqual([
      {
        keyId: `${ref}:v1`,
        version: 1,
        alg: 'ed25519',
        publicKey: v1.publicKey,
        activatedAt: '2026-10-16T10:00:00.000Z',
        revokedAt: '2026-10-16T12:00:00.000Z',
      },
      {
        keyId: `${ref}:v2`,
        version: 2,
        alg: 'ml-dsa-65',
        publicKey: v2.publicKey,
        activatedAt: '2026-10-16T11:00:00.000Z',
        revokedAt: null,
      },
    ]);
  });

  it('refuses DELETE and field changes; revoke works once', async () => {
    const ref = keyRef();
    const ed = generateKeyPairSync('ed25519');
    const activatedAt = new Date('2026-10-16T14:00:00.000Z');
    await keys.activate({
      keyId: `${ref}:v1`,
      alg: 'ed25519',
      publicKey: encodePublicKey(ed.publicKey),
      activatedAt,
    });

    await expect(
      prisma.signingKey.delete({ where: { keyId: `${ref}:v1` } }),
    ).rejects.toThrow(/append-only|signing_keys/);

    await expect(
      prisma.signingKey.update({
        where: { keyId: `${ref}:v1` },
        data: { alg: 'ecdsa-p256' },
      }),
    ).rejects.toThrow(/fixed|signing_keys/);

    const revokedAt = new Date('2026-10-16T15:00:00.000Z');
    const revoked = await keys.revoke(`${ref}:v1`, revokedAt);
    expect(revoked.revokedAt).toBe(revokedAt.toISOString());

    await expect(
      keys.revoke(`${ref}:v1`, new Date('2026-10-16T16:00:00.000Z')),
    ).rejects.toThrow(/fixed|signing_keys/);
  });

  it('grants auditor_ro SELECT on crypto.signing_keys', async () => {
    const rows = await prisma.$queryRawUnsafe<{ ok: boolean }[]>(
      `SELECT has_table_privilege('auditor_ro', 'crypto.signing_keys', 'SELECT') AS ok`,
    );
    expect(rows[0].ok).toBe(true);
  });
});
