import { ConfigService } from '@nestjs/config';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import type { MetricsService } from '../../common/metrics/metrics.service.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { LocalTestSigner } from './adapters/local-test.signer.js';
import { SignerContractException } from './exceptions/signer-contract.exception.js';
import type { SignatureEnvelope, Signer, SigningAlg } from './signer.js';
import { SignerService } from './signer.service.js';
import type { SigningKeysService } from './signing-keys.service.js';

function configOf(alg: SigningAlg): ConfigService<EnvironmentVariables, true> {
  return {
    get: () => alg,
  } as unknown as ConfigService<EnvironmentVariables, true>;
}

/** Catalog stub: unknown keys are not revoked (same as an empty `crypto.signing_keys`). */
function keysStub(
  find: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(null),
): SigningKeysService {
  return { find } as unknown as SigningKeysService;
}

// Test double for an adapter: an Ed25519 key generated per run, never stored
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const backend = {
  sign: vi.fn(
    async (bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope> => ({
      alg: 'ed25519',
      keyId: `${keyRef}:v1`,
      sig: sign(null, bytes, privateKey).toString('base64'),
    }),
  ),
  verify: vi.fn(async (bytes: Uint8Array, s: SignatureEnvelope) =>
    verify(null, bytes, publicKey, Buffer.from(s.sig, 'base64')),
  ),
} satisfies Signer;

const service = new SignerService(backend, keysStub(), configOf('ed25519'));
const message = new TextEncoder().encode('tree_size=42');

describe('SignerService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signs with the requested key and verifies the signature', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    expect(envelope).toEqual({
      alg: 'ed25519',
      keyId: 'audit-signing:v1',
      sig: expect.stringMatching(/^[A-Za-z0-9+/]{86}==$/),
    });
    expect(await service.verify(message, envelope)).toBe(true);
  });

  it('verifies false for other bytes', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    expect(
      await service.verify(new TextEncoder().encode('tree_size=41'), envelope),
    ).toBe(false);
  });

  it('returns only the envelope fields', async () => {
    backend.sign.mockResolvedValueOnce({
      ...(await backend.sign(message, 'audit-signing')),
      privateKey: 'leak',
    } as SignatureEnvelope);
    expect(
      Object.keys(await service.sign(message, 'audit-signing')).sort(),
    ).toEqual(['alg', 'keyId', 'sig']);
  });

  it('refuses an invalid key name before calling the adapter', async () => {
    await expect(service.sign(message, 'Audit Signing')).rejects.toThrow(
      'Invalid key name',
    );
    expect(backend.sign).not.toHaveBeenCalled();
  });

  const good = async () => backend.sign(message, 'audit-signing');
  it.each<[string, (e: SignatureEnvelope) => unknown]>([
    ['an unknown alg', (e) => ({ ...e, alg: 'rsa-2048' })],
    ['a keyId without version', (e) => ({ ...e, keyId: 'audit-signing' })],
    ['a signature of the wrong length', (e) => ({ ...e, sig: 'AAAA' })],
    ['non-canonical base64', (e) => ({ ...e, sig: `${e.sig.slice(0, -2)}` })],
    [
      'base64url instead of base64',
      () => ({
        alg: 'ed25519',
        keyId: 'audit-signing:v1',
        sig: '_'.repeat(86) + '==',
      }),
    ],
    ['no envelope', () => null],
  ])(
    'throws SignerContractException when the adapter returns %s',
    async (_, change) => {
      backend.sign.mockResolvedValueOnce(
        change(await good()) as SignatureEnvelope,
      );
      await expect(service.sign(message, 'audit-signing')).rejects.toThrow(
        SignerContractException,
      );
    },
  );

  it('throws SignerContractException when the adapter signs with another key', async () => {
    backend.sign.mockResolvedValueOnce({
      ...(await good()),
      keyId: 'other-key:v1',
    });
    await expect(service.sign(message, 'audit-signing')).rejects.toThrow(
      /signed with other-key:v1, not a version of audit-signing/,
    );
  });

  it('throws when the adapter alg does not match SIGNING_ALG', async () => {
    const strict = new SignerService(
      backend,
      keysStub(),
      configOf('ml-dsa-65'),
    );
    await expect(strict.sign(message, 'audit-signing')).rejects.toThrow(
      /signed with ed25519, configured SIGNING_ALG is ml-dsa-65/,
    );
  });

  it('still verifies a registered alg after SIGNING_ALG switches', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    const switched = new SignerService(
      backend,
      keysStub(),
      configOf('ml-dsa-65'),
    );
    expect(await switched.verify(message, envelope)).toBe(true);
  });

  it('after rotate to ml-dsa-65 by config, both old and new signatures verify', async () => {
    // OpenBao has no ML-DSA; LocalTestSigner stands in for the crypto-agility switch (2.7).
    const local = new LocalTestSigner('ed25519', 'test');
    const catalog = keysStub();
    const ed = new SignerService(local, catalog, configOf('ed25519'));
    const v1 = await ed.sign(message, 'audit-signing');
    local.rotate('audit-signing', 'ml-dsa-65');
    const pq = new SignerService(local, catalog, configOf('ml-dsa-65'));
    const v2 = await pq.sign(message, 'audit-signing');
    expect(v1).toMatchObject({ alg: 'ed25519', keyId: 'audit-signing:v1' });
    expect(v2).toMatchObject({ alg: 'ml-dsa-65', keyId: 'audit-signing:v2' });
    expect(await pq.verify(message, v1)).toBe(true);
    expect(await pq.verify(message, v2)).toBe(true);
    await expect(ed.sign(message, 'audit-signing')).rejects.toThrow(
      /signed with ml-dsa-65, configured SIGNING_ALG is ed25519/,
    );
  });

  it.each<[string, (e: SignatureEnvelope) => unknown]>([
    ['an unknown alg', (e) => ({ ...e, alg: 'none' })],
    ['a keyId without version', (e) => ({ ...e, keyId: 'audit-signing' })],
    ['an empty signature', (e) => ({ ...e, sig: '' })],
    ['a truncated signature', (e) => ({ ...e, sig: e.sig.slice(4) })],
    ['a non-string signature', (e) => ({ ...e, sig: 42 })],
    ['null', () => null],
  ])('verifies %s as false without asking the adapter', async (_, change) => {
    const envelope = await service.sign(message, 'audit-signing');
    vi.clearAllMocks();
    expect(
      await service.verify(message, change(envelope) as SignatureEnvelope),
    ).toBe(false);
    expect(backend.verify).not.toHaveBeenCalled();
  });

  it('passes only the envelope fields to the adapter', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    await service.verify(message, {
      ...envelope,
      extra: true,
    } as SignatureEnvelope);
    expect(backend.verify).toHaveBeenCalledWith(message, envelope);
  });

  it('treats a non-boolean adapter answer as false', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    backend.verify.mockResolvedValueOnce('yes' as unknown as boolean);
    expect(await service.verify(message, envelope)).toBe(false);
  });

  it('lets key store failures propagate instead of verifying false', async () => {
    const envelope = await service.sign(message, 'audit-signing');
    backend.verify.mockRejectedValueOnce(new Error('OpenBao unreachable'));
    await expect(service.verify(message, envelope)).rejects.toThrow(
      'OpenBao unreachable',
    );
  });

  it('rejects verify when the catalog marks the key revoked', async () => {
    const find = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey: 'unused',
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: '2026-10-16T18:00:00.000Z',
    });
    const revoked = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await revoked.sign(message, 'audit-signing');
    vi.clearAllMocks();
    expect(await revoked.verify(message, envelope)).toBe(false);
    expect(backend.verify).not.toHaveBeenCalled();
    expect(find).toHaveBeenCalledWith('audit-signing:v1');
  });

  it('verifies a revoked key when the artifact is anchored strictly before revokedAt', async () => {
    const find = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey: 'unused',
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: '2026-10-16T18:00:00.000Z',
    });
    const revoked = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await revoked.sign(message, 'audit-signing');
    vi.clearAllMocks();
    const anchor = {
      signedAt: new Date('2026-10-16T17:59:59.000Z'),
      anchored: true,
    };
    expect(await revoked.verify(message, envelope, anchor)).toBe(true);
    expect(
      await revoked.verify(
        new TextEncoder().encode('tree_size=41'),
        envelope,
        anchor,
      ),
    ).toBe(false);
    expect(backend.verify).toHaveBeenCalledWith(message, envelope);
  });

  it('rejects a revoked key at or after revokedAt even when the artifact is anchored', async () => {
    const find = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey: 'unused',
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: '2026-10-16T18:00:00.000Z',
    });
    const revoked = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await revoked.sign(message, 'audit-signing');
    vi.clearAllMocks();
    expect(
      await revoked.verify(message, envelope, {
        signedAt: new Date('2026-10-16T18:00:00.000Z'),
        anchored: true,
      }),
    ).toBe(false);
    expect(
      await revoked.verify(message, envelope, {
        signedAt: new Date('2026-10-16T18:00:01.000Z'),
        anchored: true,
      }),
    ).toBe(false);
    expect(backend.verify).not.toHaveBeenCalled();
  });

  it('rejects a pre-revocation signature when the TSA token is not stored', async () => {
    const find = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey: 'unused',
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: '2026-10-16T18:00:00.000Z',
    });
    const revoked = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await revoked.sign(message, 'audit-signing');
    vi.clearAllMocks();
    expect(
      await revoked.verify(message, envelope, {
        signedAt: new Date('2026-10-16T12:00:00.000Z'),
        anchored: false,
      }),
    ).toBe(false);
    expect(backend.verify).not.toHaveBeenCalled();
  });

  it('still verifies when the catalog lists the key without revokedAt', async () => {
    const find = vi.fn().mockResolvedValue({
      keyId: 'audit-signing:v1',
      version: 1,
      alg: 'ed25519',
      publicKey: 'unused',
      activatedAt: '2026-10-16T12:00:00.000Z',
      revokedAt: null,
    });
    const active = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await active.sign(message, 'audit-signing');
    expect(await active.verify(message, envelope)).toBe(true);
    expect(backend.verify).toHaveBeenCalled();
  });

  it('counts every false verify and not a true one or a key-store error', async () => {
    const recordSignatureVerifyFailure = vi.fn();
    const counted = new SignerService(
      backend,
      keysStub(),
      configOf('ed25519'),
      { recordSignatureVerifyFailure } as unknown as MetricsService,
    );
    const envelope = await counted.sign(message, 'audit-signing');
    expect(await counted.verify(message, envelope)).toBe(true);
    expect(recordSignatureVerifyFailure).not.toHaveBeenCalled();
    expect(
      await counted.verify(new TextEncoder().encode('tree_size=41'), envelope),
    ).toBe(false);
    expect(await counted.verify(message, { ...envelope, sig: '' })).toBe(false);
    expect(recordSignatureVerifyFailure).toHaveBeenCalledTimes(2);
    backend.verify.mockRejectedValueOnce(new Error('OpenBao unreachable'));
    await expect(counted.verify(message, envelope)).rejects.toThrow(
      'OpenBao unreachable',
    );
    expect(recordSignatureVerifyFailure).toHaveBeenCalledTimes(2);
  });

  it('lets catalog lookup failures propagate instead of verifying false', async () => {
    const find = vi.fn().mockRejectedValue(new Error('postgres down'));
    const broken = new SignerService(
      backend,
      keysStub(find),
      configOf('ed25519'),
    );
    const envelope = await broken.sign(message, 'audit-signing');
    await expect(broken.verify(message, envelope)).rejects.toThrow(
      'postgres down',
    );
    expect(backend.verify).not.toHaveBeenCalled();
  });
});
