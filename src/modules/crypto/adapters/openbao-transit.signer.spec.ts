import { generateKeyPairSync, sign } from 'node:crypto';
import { KeyStoreException } from '../exceptions/key-store.exception.js';
import { OpenBaoTransitSigner } from './openbao-transit.signer.js';

const TOKEN = 'test-token-not-a-secret';
const message = new TextEncoder().encode('checkpoint 42');
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const rawPublicKey = Buffer.from(
  publicKey.export({ format: 'jwk' }).x as string,
  'base64url',
).toString('base64');
const sigB64 = sign(null, message, privateKey).toString('base64');

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const keyInfo = (
  type = 'ed25519',
  keys: Record<string, unknown> = {
    1: { public_key: rawPublicKey },
  },
) => json(200, { data: { type, keys } });

const fetchFn = vi.fn<typeof fetch>();
const signer = () =>
  new OpenBaoTransitSigner('http://bao:8200/', TOKEN, fetchFn);

describe('OpenBaoTransitSigner', () => {
  beforeEach(() => {
    fetchFn.mockReset();
  });

  it('signs with transit/sign and reports the key version', async () => {
    fetchFn.mockResolvedValueOnce(keyInfo()).mockResolvedValueOnce(
      json(200, {
        data: { signature: `vault:v1:${sigB64}`, key_version: 1 },
      }),
    );
    expect(await signer().sign(message, 'audit-signing')).toEqual({
      alg: 'ed25519',
      keyId: 'audit-signing:v1',
      sig: sigB64,
    });
    const [url, init] = fetchFn.mock.calls[1];
    expect(url).toBe('http://bao:8200/v1/transit/sign/audit-signing');
    expect(init).toMatchObject({
      method: 'POST',
      headers: { 'X-Vault-Token': TOKEN, 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init?.body as string)).toEqual({
      input: Buffer.from(message).toString('base64'),
    });
  });

  it('rotates Transit and lists public versions oldest first', async () => {
    fetchFn
      .mockResolvedValueOnce(keyInfo())
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        keyInfo('ed25519', {
          1: {
            public_key: rawPublicKey,
            creation_time: '2026-10-16T10:00:00Z',
          },
          2: {
            public_key: rawPublicKey,
            creation_time: '2026-10-16T11:00:00Z',
          },
        }),
      );
    const s = signer();
    await s.rotate('audit-signing');
    expect(fetchFn.mock.calls[1][0]).toBe(
      'http://bao:8200/v1/transit/keys/audit-signing/rotate',
    );
    const listed = await s.publicVersions('audit-signing');
    expect(listed.alg).toBe('ed25519');
    expect(listed.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(listed.versions[0].activatedAt?.toISOString()).toBe(
      '2026-10-16T10:00:00.000Z',
    );
  });

  it('reports ecdsa-p256 for an ecdsa-p256 key', async () => {
    fetchFn
      .mockResolvedValueOnce(keyInfo('ecdsa-p256'))
      .mockResolvedValueOnce(
        json(200, { data: { signature: 'vault:v3:MEUCIQ==', key_version: 3 } }),
      );
    expect(await signer().sign(message, 'k')).toMatchObject({
      alg: 'ecdsa-p256',
      keyId: 'k:v3',
    });
  });

  it.each([
    ['a version that differs from key_version', 'vault:v2:AAAA', 1],
    ['another format', 'AAAA', 1],
    ['v0', 'vault:v0:AAAA', 0],
  ])('throws KeyStoreException for %s', async (_, signature, version) => {
    fetchFn
      .mockResolvedValueOnce(keyInfo())
      .mockResolvedValueOnce(
        json(200, { data: { signature, key_version: version } }),
      );
    await expect(signer().sign(message, 'k')).rejects.toThrow(
      KeyStoreException,
    );
  });

  it('refuses key types that cannot sign here', async () => {
    fetchFn.mockResolvedValueOnce(keyInfo('aes256-gcm96'));
    await expect(signer().sign(message, 'k')).rejects.toThrow(
      'Transit key k has type aes256-gcm96, which cannot sign here',
    );
  });

  it('throws when the key does not exist', async () => {
    fetchFn.mockResolvedValueOnce(json(404, { errors: [] }));
    await expect(signer().sign(message, 'k')).rejects.toThrow(
      'Transit key k not found',
    );
  });

  it('names the status and OpenBao error but never the token', async () => {
    fetchFn.mockResolvedValueOnce(json(403, { errors: ['permission denied'] }));
    const err = await signer()
      .sign(message, 'k')
      .then(
        () => new Error('expected a failure'),
        (e: unknown) => e as Error,
      );
    expect(err).toBeInstanceOf(KeyStoreException);
    expect(err.message).toBe(
      'OpenBao GET transit/keys/k answered HTTP 403: permission denied',
    );
    expect(err.message).not.toContain(TOKEN);
  });

  it('wraps network errors', async () => {
    fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(signer().sign(message, 'k')).rejects.toThrow(
      'OpenBao GET transit/keys/k failed',
    );
  });

  describe('verify', () => {
    const signature = {
      alg: 'ed25519' as const,
      keyId: 'audit-signing:v1',
      sig: sigB64,
    };

    it('verifies with the public key of the named version, read once', async () => {
      fetchFn.mockResolvedValue(keyInfo());
      const s = signer();
      expect(await s.verify(message, signature)).toBe(true);
      expect(await s.verify(new TextEncoder().encode('x'), signature)).toBe(
        false,
      );
      expect(fetchFn).toHaveBeenCalledOnce();
      expect(fetchFn.mock.calls[0][0]).toBe(
        'http://bao:8200/v1/transit/keys/audit-signing',
      );
    });

    it('verifies false for an unknown version or key, and asks again later', async () => {
      fetchFn
        .mockResolvedValueOnce(keyInfo())
        .mockResolvedValueOnce(json(404, { errors: [] }));
      const s = signer();
      expect(
        await s.verify(message, { ...signature, keyId: 'audit-signing:v2' }),
      ).toBe(false);
      expect(await s.verify(message, { ...signature, keyId: 'x:v1' })).toBe(
        false,
      );
      fetchFn.mockResolvedValueOnce(
        keyInfo('ed25519', {
          1: { public_key: rawPublicKey },
          2: { public_key: rawPublicKey },
        }),
      );
      expect(
        await s.verify(message, { ...signature, keyId: 'audit-signing:v2' }),
      ).toBe(true);
    });

    it('throws instead of answering false when OpenBao cannot answer, and does not cache it', async () => {
      fetchFn.mockResolvedValueOnce(json(500, { errors: ['sealed'] }));
      const s = signer();
      await expect(s.verify(message, signature)).rejects.toThrow(
        KeyStoreException,
      );
      fetchFn.mockResolvedValueOnce(keyInfo());
      expect(await s.verify(message, signature)).toBe(true);
    });

    it('verifies false when the envelope names another algorithm than the key', async () => {
      fetchFn.mockResolvedValue(keyInfo());
      expect(
        await signer().verify(message, { ...signature, alg: 'ecdsa-p256' }),
      ).toBe(false);
    });

    it('reads an ECDSA public key from PEM', async () => {
      const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
      const pem = ec.publicKey.export({ format: 'pem', type: 'spki' });
      fetchFn.mockResolvedValue(
        keyInfo('ecdsa-p256', { 1: { public_key: pem } }),
      );
      const sig = sign('sha256', message, ec.privateKey).toString('base64');
      expect(
        await signer().verify(message, {
          alg: 'ecdsa-p256',
          keyId: 'k:v1',
          sig,
        }),
      ).toBe(true);
    });
  });
});
