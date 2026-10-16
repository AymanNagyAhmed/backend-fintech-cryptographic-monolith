import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { OpenBaoTransitSigner } from '../src/modules/crypto/adapters/openbao-transit.signer.js';
import { CryptoModule } from '../src/modules/crypto/crypto.module.js';
import { KeyStoreException } from '../src/modules/crypto/exceptions/key-store.exception.js';
import { SignerContractException } from '../src/modules/crypto/exceptions/signer-contract.exception.js';
import type { SignatureEnvelope } from '../src/modules/crypto/signer.js';
import { SignerService } from '../src/modules/crypto/signer.service.js';

// Needs the Compose OpenBao (`make up`) with Transit enabled (plan A-B1.9) and BAO_TOKEN =
// the dev root token in .env (SIGNER_BACKEND=openbao). Creates its own keys and deletes them.
describe('Signer with OpenBao Transit (e2e)', () => {
  let moduleRef: TestingModule;
  let signer: SignerService;
  const created: string[] = [];
  const message = new TextEncoder().encode(`checkpoint ${randomUUID()}`);

  const bao = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${process.env.BAO_ADDR}/v1/${path}`, {
      method,
      headers: { 'X-Vault-Token': process.env.BAO_TOKEN ?? '' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 204)
      throw new Error(`${method} ${path}: HTTP ${res.status}`);
    return res.status === 204
      ? null
      : ((await res.json()) as { data: Record<string, unknown> });
  };
  const newKey = async (type: string) => {
    const name = `e2e-${type}-${randomUUID().slice(0, 8)}`;
    await bao('POST', `transit/keys/${name}`, { type });
    created.push(name);
    return name;
  };
  /** OpenBao's own verification of our envelope, as a cross-check of local verification. */
  const baoVerifies = async (key: string, s: SignatureEnvelope) => {
    const version = s.keyId.split(':v')[1];
    const res = await bao('POST', `transit/verify/${key}`, {
      input: Buffer.from(message).toString('base64'),
      signature: `vault:v${version}:${s.sig}`,
    });
    return res?.data.valid;
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        CryptoModule,
      ],
    }).compile();
    signer = moduleRef.get(SignerService);
  });

  afterAll(async () => {
    for (const name of created) {
      await bao('POST', `transit/keys/${name}/config`, {
        deletion_allowed: true,
      });
      await bao('DELETE', `transit/keys/${name}`);
    }
    await moduleRef.close();
  });

  describe.each(['ed25519', 'ecdsa-p256'] as const)('%s key', (type) => {
    let key: string;
    let v1: SignatureEnvelope;

    beforeAll(async () => {
      key = await newKey(type);
      v1 = await signer.sign(message, key);
    });

    it('signs with version 1 and verifies locally and in OpenBao', async () => {
      expect(v1).toMatchObject({ alg: type, keyId: `${key}:v1` });
      expect(await signer.verify(message, v1)).toBe(true);
      expect(await baoVerifies(key, v1)).toBe(true);
    });

    it('verifies false for other bytes, another alg or a missing version', async () => {
      expect(await signer.verify(new TextEncoder().encode('x'), v1)).toBe(
        false,
      );
      expect(
        await signer.verify(message, {
          ...v1,
          alg: type === 'ed25519' ? 'ecdsa-p256' : 'ed25519',
        }),
      ).toBe(false);
      expect(await signer.verify(message, { ...v1, keyId: `${key}:v9` })).toBe(
        false,
      );
    });

    it('after a rotation signs with v2 and still verifies v1', async () => {
      await bao('POST', `transit/keys/${key}/rotate`);
      const v2 = await signer.sign(message, key);
      expect(v2).toMatchObject({ alg: type, keyId: `${key}:v2` });
      expect(await signer.verify(message, v2)).toBe(true);
      expect(await signer.verify(message, v1)).toBe(true);
      expect(await baoVerifies(key, v2)).toBe(true);
      expect(await signer.verify(message, { ...v1, keyId: `${key}:v2` })).toBe(
        false,
      );
    });
  });

  it('verifies false for a key that does not exist', async () => {
    const key = await newKey('ed25519');
    const signature = await signer.sign(message, key);
    expect(
      await signer.verify(message, { ...signature, keyId: 'e2e-missing:v1' }),
    ).toBe(false);
  });

  it('refuses to sign with a missing key or a non-signing key', async () => {
    await expect(signer.sign(message, 'e2e-missing')).rejects.toThrow(
      'Transit key e2e-missing not found',
    );
    const aes = await newKey('aes256-gcm96');
    await expect(signer.sign(message, aes)).rejects.toThrow(
      'which cannot sign here',
    );
  });

  it('throws KeyStoreException, not false, when OpenBao is unreachable', async () => {
    const down = new SignerService(
      new OpenBaoTransitSigner('http://127.0.0.1:1', 'x'.repeat(20)),
    );
    await expect(
      down.verify(message, {
        alg: 'ed25519',
        keyId: 'audit-signing:v1',
        sig: Buffer.alloc(64).toString('base64'),
      }),
    ).rejects.toThrow(KeyStoreException);
  });

  it('throws KeyStoreException for a token without access', async () => {
    const key = await newKey('ed25519');
    const denied = new SignerService(
      new OpenBaoTransitSigner(process.env.BAO_ADDR ?? '', 'x'.repeat(20)),
    );
    await expect(denied.sign(message, key)).rejects.toThrow(/HTTP 403/);
  });

  it('never returns a signature from an adapter that breaks the contract', async () => {
    const lying = new SignerService({
      sign: () =>
        Promise.resolve({ alg: 'ed25519', keyId: 'other:v1', sig: 'AA==' }),
      verify: () => Promise.resolve(true),
    });
    await expect(lying.sign(message, 'audit-signing')).rejects.toThrow(
      SignerContractException,
    );
  });
});
