import type { ConfigService } from '@nestjs/config';
import { generateKeyPairSync } from 'node:crypto';
import {
  canonicalRequest,
  ed25519Signature,
  hmacSignature,
} from '../../../common/request-signing/canonical-request.js';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import type { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import {
  ApiClientsService,
  HMAC_SECRET_PREFIX,
} from './api-clients.service.js';

interface Row {
  id: string;
  clientId: string;
  name: string;
  algorithm: 'hmac_sha256' | 'ed25519';
  secretEnc: string | null;
  publicKey: string | null;
  revokedAt: Date | null;
}

const fakePrisma = () => {
  const rows = new Map<string, Row>();
  const apiClient = {
    create: vi.fn(
      async ({
        data,
      }: {
        data: Pick<Row, 'clientId' | 'name' | 'algorithm'> &
          Partial<Pick<Row, 'secretEnc' | 'publicKey'>>;
      }) => {
        if (rows.has(data.clientId))
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed',
            {
              code: 'P2002',
              clientVersion: 'test',
            },
          );
        const row: Row = {
          secretEnc: null,
          publicKey: null,
          ...data,
          id: `id-${data.clientId}`,
          revokedAt: null,
        };
        rows.set(row.clientId, row);
        return { id: row.id, clientId: row.clientId };
      },
    ),
    findUnique: vi.fn(
      async ({ where }: { where: { clientId: string } }) =>
        rows.get(where.clientId) ?? null,
    ),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { clientId: string };
        data: { revokedAt: Date };
      }) => {
        const row = rows.get(where.clientId);
        if (!row || row.revokedAt) return { count: 0 };
        row.revokedAt = data.revokedAt;
        return { count: 1 };
      },
    ),
  };
  return { rows, prisma: { apiClient } as unknown as PrismaService };
};

const config = {
  get: () => Buffer.alloc(32, 9).toString('base64'),
} as unknown as ConfigService<EnvironmentVariables, true>;

const canonical = canonicalRequest({
  method: 'POST',
  path: '/v1/b2b/ping',
  timestamp: '1760371200',
  nonce: 'n0nce-0123456789ab',
  body: '{}',
});

describe('ApiClientsService', () => {
  let rows: Map<string, Row>;
  let service: ApiClientsService;

  beforeEach(() => {
    const fake = fakePrisma();
    rows = fake.rows;
    service = new ApiClientsService(fake.prisma, config);
  });

  it('creates an HMAC client: the secret is returned once and stored sealed', async () => {
    const created = await service.create({
      clientId: 'dev-client',
      name: ' Dev ',
      algorithm: 'hmac_sha256',
    });
    expect(created.secret).toMatch(
      new RegExp(`^${HMAC_SECRET_PREFIX}[A-Za-z0-9_-]{43}$`),
    );
    const row = rows.get('dev-client')!;
    expect(row.name).toBe('Dev');
    expect(row.secretEnc).toMatch(/^v1\./);
    expect(row.secretEnc).not.toContain(
      created.secret!.slice(HMAC_SECRET_PREFIX.length),
    );

    const verifier = (await service.findVerifier('dev-client'))!;
    const good = Buffer.from(
      hmacSignature(created.secret!, canonical),
      'base64',
    );
    expect(verifier.verify(canonical, good)).toBe(true);
    expect(verifier.verify(`${canonical}x`, good)).toBe(false);
    expect(verifier.verify(canonical, good.subarray(0, 16))).toBe(false);
  });

  it('a sealed secret copied to another client does not open', async () => {
    await service.create({
      clientId: 'client-a',
      name: 'A',
      algorithm: 'hmac_sha256',
    });
    await service.create({
      clientId: 'client-b',
      name: 'B',
      algorithm: 'hmac_sha256',
    });
    rows.get('client-b')!.secretEnc = rows.get('client-a')!.secretEnc;
    await expect(service.findVerifier('client-b')).rejects.toThrow();
  });

  it('creates an Ed25519 client from a public key and verifies its signatures', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const created = await service.create({
      clientId: 'partner-x',
      name: 'Partner X',
      algorithm: 'ed25519',
      publicKey,
    });
    expect(created.secret).toBeUndefined();
    expect(rows.get('partner-x')!.publicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const verifier = (await service.findVerifier('partner-x'))!;
    const sig = Buffer.from(ed25519Signature(privateKey, canonical), 'base64');
    expect(verifier.verify(canonical, sig)).toBe(true);
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(
      verifier.verify(
        canonical,
        Buffer.from(ed25519Signature(other, canonical), 'base64'),
      ),
    ).toBe(false);
  });

  it('refuses a non-Ed25519 key, a bad client id and a duplicate', async () => {
    const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await expect(
      service.create({
        clientId: 'partner-y',
        name: 'Y',
        algorithm: 'ed25519',
        publicKey,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.create({
        clientId: 'Bad_Id',
        name: 'Y',
        algorithm: 'hmac_sha256',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    await service.create({
      clientId: 'dup-client',
      name: 'D',
      algorithm: 'hmac_sha256',
    });
    await expect(
      service.create({
        clientId: 'dup-client',
        name: 'D',
        algorithm: 'hmac_sha256',
      }),
    ).rejects.toMatchObject({ code: 'CLIENT_ID_TAKEN', statusCode: 409 });
  });

  it('a revoked or unknown client has no verifier; revoke works once', async () => {
    await service.create({
      clientId: 'dev-client',
      name: 'Dev',
      algorithm: 'hmac_sha256',
    });
    await expect(service.revoke('dev-client')).resolves.toBe(true);
    await expect(service.revoke('dev-client')).resolves.toBe(false);
    await expect(service.findVerifier('dev-client')).resolves.toBeNull();
    await expect(service.findVerifier('nobody-here')).resolves.toBeNull();
  });
});
