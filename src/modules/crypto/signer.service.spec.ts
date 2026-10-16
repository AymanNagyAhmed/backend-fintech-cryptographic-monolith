import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { SignerContractException } from './exceptions/signer-contract.exception.js';
import type { SignatureEnvelope, Signer } from './signer.js';
import { SignerService } from './signer.service.js';

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

const service = new SignerService(backend);
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
});
