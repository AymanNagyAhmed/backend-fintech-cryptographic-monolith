import { generateKeyPairSync } from 'node:crypto';
import type { OpenBaoTransitSigner } from './adapters/openbao-transit.signer.js';
import { encodePublicKey } from './public-key.js';
import { KeyRotationService } from './key-rotation.service.js';
import type { SigningKeysService } from './signing-keys.service.js';

const ed = generateKeyPairSync('ed25519');
const v1Key = encodePublicKey(ed.publicKey);
const ed2 = generateKeyPairSync('ed25519');
const v2Key = encodePublicKey(ed2.publicKey);

describe('KeyRotationService', () => {
  it('rotates Transit then publishes only missing catalog rows', async () => {
    const rotate = vi.fn().mockResolvedValue(undefined);
    const publicVersions = vi.fn().mockResolvedValue({
      alg: 'ed25519',
      versions: [
        {
          version: 1,
          publicKey: ed.publicKey,
          activatedAt: new Date('2026-10-16T10:00:00.000Z'),
        },
        {
          version: 2,
          publicKey: ed2.publicKey,
          activatedAt: new Date('2026-10-16T11:00:00.000Z'),
        },
      ],
    });
    const find = vi
      .fn()
      .mockResolvedValueOnce({
        keyId: 'audit-signing:v1',
        version: 1,
        alg: 'ed25519',
        publicKey: v1Key,
        activatedAt: '2026-10-16T10:00:00.000Z',
        revokedAt: null,
      })
      .mockResolvedValueOnce(null);
    const activate = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v2',
      version: 2,
      alg: 'ed25519',
      publicKey: v2Key,
      activatedAt: '2026-10-16T11:00:00.000Z',
      revokedAt: null,
    });

    const service = new KeyRotationService(
      { rotate, publicVersions } as unknown as OpenBaoTransitSigner,
      { find, activate } as unknown as SigningKeysService,
    );

    await expect(service.rotate('audit-signing')).resolves.toEqual({
      keyRef: 'audit-signing',
      alg: 'ed25519',
      latestVersion: 2,
      published: [
        {
          keyId: 'audit-signing:v2',
          version: 2,
          alg: 'ed25519',
          publicKey: v2Key,
          activatedAt: '2026-10-16T11:00:00.000Z',
          revokedAt: null,
        },
      ],
    });
    expect(rotate).toHaveBeenCalledWith('audit-signing');
    expect(activate).toHaveBeenCalledWith({
      keyId: 'audit-signing:v2',
      alg: 'ed25519',
      publicKey: v2Key,
      activatedAt: new Date('2026-10-16T11:00:00.000Z'),
    });
  });

  it('refuses an invalid key name before calling the store', async () => {
    const rotate = vi.fn();
    const service = new KeyRotationService(
      { rotate, publicVersions: vi.fn() } as unknown as OpenBaoTransitSigner,
      { find: vi.fn(), activate: vi.fn() } as unknown as SigningKeysService,
    );
    await expect(service.rotate('Bad Name')).rejects.toThrow(
      'Invalid key name',
    );
    expect(rotate).not.toHaveBeenCalled();
  });
});
