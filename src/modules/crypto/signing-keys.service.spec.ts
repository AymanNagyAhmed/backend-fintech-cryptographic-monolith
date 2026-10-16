import { generateKeyPairSync } from 'node:crypto';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { encodePublicKey } from './public-key.js';
import { SigningKeysService } from './signing-keys.service.js';

const ed = generateKeyPairSync('ed25519');
const publicKey = encodePublicKey(ed.publicKey);

function prismaStub(
  overrides: {
    findMany?: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
    update?: ReturnType<typeof vi.fn>;
    findUnique?: ReturnType<typeof vi.fn>;
  } = {},
) {
  return {
    signingKey: {
      findMany: overrides.findMany ?? vi.fn().mockResolvedValue([]),
      create:
        overrides.create ??
        vi.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            ...data,
            activatedAt:
              data.activatedAt ?? new Date('2026-10-16T12:00:00.000Z'),
            revokedAt: null,
          }),
        ),
      update: overrides.update ?? vi.fn(),
      findUnique: overrides.findUnique ?? vi.fn().mockResolvedValue(null),
    },
  };
}

describe('SigningKeysService', () => {
  it('lists keys oldest first as DTOs', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        keyId: 'audit-signing:v1',
        version: 1,
        alg: 'ed25519',
        publicKey,
        activatedAt: new Date('2026-10-16T12:00:00.000Z'),
        revokedAt: null,
      },
    ]);
    const service = new SigningKeysService(prismaStub({ findMany }) as never);
    await expect(service.list()).resolves.toEqual([
      {
        keyId: 'audit-signing:v1',
        version: 1,
        alg: 'ed25519',
        publicKey,
        activatedAt: '2026-10-16T12:00:00.000Z',
        revokedAt: null,
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      orderBy: [{ activatedAt: 'asc' }, { keyId: 'asc' }],
    });
  });

  it('activates a well-formed public key', async () => {
    const service = new SigningKeysService(prismaStub() as never);
    const dto = await service.activate({
      keyId: 'audit-signing:v1',
      alg: 'ed25519',
      publicKey,
    });
    expect(dto).toMatchObject({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey,
      revokedAt: null,
    });
  });

  it.each([
    [
      'bad keyId',
      { keyId: 'audit-signing', alg: 'ed25519' as const, publicKey },
    ],
    [
      'wrong alg for the key',
      { keyId: 'audit-signing:v1', alg: 'ecdsa-p256' as const, publicKey },
    ],
    [
      'garbage public key',
      {
        keyId: 'audit-signing:v1',
        alg: 'ed25519' as const,
        publicKey: 'AAAA',
      },
    ],
  ])('refuses %s', async (_, input) => {
    const service = new SigningKeysService(prismaStub() as never);
    await expect(service.activate(input)).rejects.toBeInstanceOf(
      DomainException,
    );
  });

  it('revokes an active key', async () => {
    const revokedAt = new Date('2026-10-16T18:00:00.000Z');
    const update = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey,
      activatedAt: new Date('2026-10-16T12:00:00.000Z'),
      revokedAt,
    });
    const service = new SigningKeysService(prismaStub({ update }) as never);
    await expect(
      service.revoke('audit-signing:v1', revokedAt),
    ).resolves.toEqual({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey,
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: '2026-10-16T18:00:00.000Z',
    });
  });

  it('answers SIGNING_KEY_NOT_FOUND when revoking a missing key', async () => {
    const update = vi.fn().mockRejectedValue(new Error('Record not found'));
    const service = new SigningKeysService(
      prismaStub({
        update,
        findUnique: vi.fn().mockResolvedValue(null),
      }) as never,
    );
    await expect(service.revoke('missing:v1')).rejects.toMatchObject({
      code: 'SIGNING_KEY_NOT_FOUND',
    });
  });
});
