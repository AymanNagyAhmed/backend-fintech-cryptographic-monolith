import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  type KMSClient,
  ListAliasesCommand,
  NotFoundException,
  SignCommand,
} from '@aws-sdk/client-kms';
import { generateKeyPairSync, sign } from 'node:crypto';
import { KeyStoreException } from '../exceptions/key-store.exception.js';
import { AwsKmsSigner, KMS_MAX_MESSAGE_BYTES } from './aws-kms.signer.js';

const ARN_V2 = 'arn:aws:kms:us-east-1:111122223333:key/v2';
const message = new TextEncoder().encode('checkpoint 42');
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const mldsa = generateKeyPairSync('ml-dsa-65');
const spki = (key: typeof ec.publicKey) =>
  new Uint8Array(key.export({ format: 'der', type: 'spki' }));

const send = vi.fn();
const client = { send } as unknown as KMSClient;

/** Answers by command type; `over` replaces single answers. */
function kmsAnswers(over: Partial<Record<string, unknown>> = {}) {
  send.mockImplementation((command: object) => {
    const name = command.constructor.name;
    if (Object.hasOwn(over, name)) {
      const answer = over[name];
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    }
    switch (name) {
      case DescribeKeyCommand.name:
        return Promise.resolve({
          KeyMetadata: {
            Arn: ARN_V2,
            KeySpec: 'ECC_NIST_P256',
            KeyUsage: 'SIGN_VERIFY',
          },
        });
      case ListAliasesCommand.name:
        return Promise.resolve({
          Aliases: [
            { AliasName: 'alias/audit-signing' },
            { AliasName: 'alias/audit-signing-v2' },
          ],
        });
      case SignCommand.name:
        return Promise.resolve({
          KeyId: ARN_V2,
          Signature: new Uint8Array(sign('sha256', message, ec.privateKey)),
        });
      case GetPublicKeyCommand.name:
        return Promise.resolve({ PublicKey: spki(ec.publicKey) });
      default:
        return Promise.reject(new Error(`unexpected ${name}`));
    }
  });
}
function inputOf(cls: { name: string }): Record<string, unknown> {
  const call = send.mock.calls.find(([c]) => c.constructor.name === cls.name);
  if (!call) throw new Error(`${cls.name} was not sent`);
  return (call[0] as { input: Record<string, unknown> }).input;
}

describe('AwsKmsSigner', () => {
  beforeEach(() => {
    send.mockReset();
    kmsAnswers();
  });

  it('signs with the key behind the alias and names its version alias', async () => {
    const signature = await new AwsKmsSigner(client).sign(
      message,
      'audit-signing',
    );
    expect(signature).toMatchObject({
      alg: 'ecdsa-p256',
      keyId: 'audit-signing:v2',
    });
    expect(inputOf(DescribeKeyCommand)).toEqual({
      KeyId: 'alias/audit-signing',
    });
    expect(inputOf(SignCommand)).toEqual({
      KeyId: ARN_V2,
      Message: message,
      MessageType: 'RAW',
      SigningAlgorithm: 'ECDSA_SHA_256',
    });
  });

  it('looks up the version alias of a key once', async () => {
    const signer = new AwsKmsSigner(client);
    await signer.sign(message, 'audit-signing');
    await signer.sign(message, 'audit-signing');
    expect(
      send.mock.calls.filter(
        ([c]) => c.constructor.name === ListAliasesCommand.name,
      ),
    ).toHaveLength(1);
  });

  it.each([
    ['ECC_NIST_EDWARDS25519', 'ed25519', 'ED25519_SHA_512'],
    ['ML_DSA_65', 'ml-dsa-65', 'ML_DSA_SHAKE_256'],
  ])('maps %s to %s / %s', async (keySpec, alg, spec) => {
    kmsAnswers({
      DescribeKeyCommand: {
        KeyMetadata: { Arn: ARN_V2, KeySpec: keySpec, KeyUsage: 'SIGN_VERIFY' },
      },
      SignCommand: { KeyId: ARN_V2, Signature: new Uint8Array(64) },
    });
    const signature = await new AwsKmsSigner(client).sign(
      message,
      'audit-signing',
    );
    expect(signature.alg).toBe(alg);
    expect(inputOf(SignCommand).SigningAlgorithm).toBe(spec);
  });

  it.each([
    ['an RSA key', { KeySpec: 'RSA_2048', KeyUsage: 'SIGN_VERIFY' }],
    [
      'an encryption key',
      { KeySpec: 'ECC_NIST_P256', KeyUsage: 'ENCRYPT_DECRYPT' },
    ],
  ])('refuses %s', async (_, meta) => {
    kmsAnswers({
      DescribeKeyCommand: { KeyMetadata: { Arn: ARN_V2, ...meta } },
    });
    await expect(
      new AwsKmsSigner(client).sign(message, 'audit-signing'),
    ).rejects.toThrow(
      'KMS key alias/audit-signing is not a supported signing key',
    );
  });

  it.each([
    ['no version alias', [{ AliasName: 'alias/audit-signing' }]],
    [
      'two version aliases',
      [
        { AliasName: 'alias/audit-signing-v1' },
        { AliasName: 'alias/audit-signing-v2' },
      ],
    ],
    ['a version alias of another key name', [{ AliasName: 'alias/other-v2' }]],
  ])('refuses a key with %s', async (_, aliases) => {
    kmsAnswers({ ListAliasesCommand: { Aliases: aliases } });
    await expect(
      new AwsKmsSigner(client).sign(message, 'audit-signing'),
    ).rejects.toThrow('needs exactly one alias alias/audit-signing-v<n>');
  });

  it('refuses a signature from another key (the alias moved during the call)', async () => {
    kmsAnswers({
      SignCommand: {
        KeyId: 'arn:aws:kms:us-east-1:111122223333:key/v3',
        Signature: new Uint8Array(70),
      },
    });
    await expect(
      new AwsKmsSigner(client).sign(message, 'audit-signing'),
    ).rejects.toThrow(KeyStoreException);
  });

  it('refuses messages over the KMS RAW limit before calling KMS', async () => {
    await expect(
      new AwsKmsSigner(client).sign(
        new Uint8Array(KMS_MAX_MESSAGE_BYTES + 1),
        'audit-signing',
      ),
    ).rejects.toThrow('KMS signs at most 4096 bytes, got 4097');
    expect(send).not.toHaveBeenCalled();
  });

  it('wraps KMS errors', async () => {
    kmsAnswers({ SignCommand: new Error('ThrottlingException') });
    await expect(
      new AwsKmsSigner(client).sign(message, 'audit-signing'),
    ).rejects.toThrow('KMS Sign failed');
  });

  describe('verify', () => {
    it('verifies with the public key of the version alias', async () => {
      const signer = new AwsKmsSigner(client);
      const signature = await signer.sign(message, 'audit-signing');
      expect(await signer.verify(message, signature)).toBe(true);
      expect(inputOf(GetPublicKeyCommand)).toEqual({
        KeyId: 'alias/audit-signing-v2',
      });
    });

    it('verifies an ML-DSA-65 signature', async () => {
      kmsAnswers({ GetPublicKeyCommand: { PublicKey: spki(mldsa.publicKey) } });
      const sig = sign(null, message, mldsa.privateKey).toString('base64');
      expect(
        await new AwsKmsSigner(client).verify(message, {
          alg: 'ml-dsa-65',
          keyId: 'audit-signing:v4',
          sig,
        }),
      ).toBe(true);
    });

    it('verifies false for a version without a key', async () => {
      kmsAnswers({
        GetPublicKeyCommand: new NotFoundException({
          message: 'Alias not found',
          $metadata: {},
        }),
      });
      expect(
        await new AwsKmsSigner(client).verify(message, {
          alg: 'ecdsa-p256',
          keyId: 'audit-signing:v9',
          sig: 'MEUCIQ==',
        }),
      ).toBe(false);
    });

    it('throws when KMS cannot answer', async () => {
      kmsAnswers({ GetPublicKeyCommand: new Error('AccessDenied') });
      await expect(
        new AwsKmsSigner(client).verify(message, {
          alg: 'ecdsa-p256',
          keyId: 'audit-signing:v2',
          sig: 'MEUCIQ==',
        }),
      ).rejects.toThrow('KMS GetPublicKey for audit-signing failed');
    });
  });
});
