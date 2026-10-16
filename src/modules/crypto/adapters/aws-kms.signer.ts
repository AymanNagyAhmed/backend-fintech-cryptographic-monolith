import {
  DescribeKeyCommand,
  GetPublicKeyCommand,
  KMSClient,
  ListAliasesCommand,
  NotFoundException,
  SignCommand,
  type KeySpec,
  type SigningAlgorithmSpec,
} from '@aws-sdk/client-kms';
import { createPublicKey, type KeyObject } from 'node:crypto';
import { KeyStoreException } from '../exceptions/key-store.exception.js';
import { formatKeyId } from '../key-id.js';
import type { SignatureEnvelope, SigningAlg } from '../signer.js';
import { KeyStoreSigner } from './key-store.signer.js';

/** KMS signs at most 4096 bytes with MessageType RAW. */
export const KMS_MAX_MESSAGE_BYTES = 4096;

const KMS_ALGS: Readonly<
  Partial<Record<KeySpec, { alg: SigningAlg; spec: SigningAlgorithmSpec }>>
> = {
  ECC_NIST_EDWARDS25519: { alg: 'ed25519', spec: 'ED25519_SHA_512' },
  ECC_NIST_P256: { alg: 'ecdsa-p256', spec: 'ECDSA_SHA_256' },
  ML_DSA_65: { alg: 'ml-dsa-65', spec: 'ML_DSA_SHAKE_256' },
};

const versionAlias = (keyRef: string, version: number) =>
  `alias/${keyRef}-v${version}`;

/**
 * Prod adapter: AWS KMS asymmetric keys (2.6). KMS keys have no versions, so a key version is a
 * KMS key with the alias `alias/<keyRef>-v<n>`, and `alias/<keyRef>` points at the current one;
 * rotating means creating a key, adding the next version alias and moving `alias/<keyRef>`.
 * Signs with the key the alias resolved to, so a concurrent rotation cannot mislabel a
 * signature. Credentials come from the default AWS chain (an IAM role in production).
 */
export class AwsKmsSigner extends KeyStoreSigner {
  /** KMS key ARN -> version: a key keeps its version alias. */
  private readonly versions = new Map<string, number>();

  constructor(private readonly client: KMSClient) {
    super();
  }

  async sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope> {
    if (bytes.length > KMS_MAX_MESSAGE_BYTES)
      throw new Error(
        `KMS signs at most ${KMS_MAX_MESSAGE_BYTES} bytes, got ${bytes.length}`,
      );
    const { KeyMetadata: meta } = await kms('DescribeKey', () =>
      this.client.send(new DescribeKeyCommand({ KeyId: `alias/${keyRef}` })),
    );
    const keyArn = meta?.Arn;
    const algs = meta?.KeySpec ? KMS_ALGS[meta.KeySpec] : undefined;
    if (!keyArn || !algs || meta?.KeyUsage !== 'SIGN_VERIFY')
      throw new KeyStoreException(
        `KMS key alias/${keyRef} is not a supported signing key`,
      );
    const version = await this.versionOf(keyRef, keyArn);
    const res = await kms('Sign', () =>
      this.client.send(
        new SignCommand({
          KeyId: keyArn,
          Message: bytes,
          MessageType: 'RAW',
          SigningAlgorithm: algs.spec,
        }),
      ),
    );
    if (!res.Signature || res.KeyId !== keyArn)
      throw new KeyStoreException(
        `KMS returned an unexpected signature for alias/${keyRef}`,
      );
    return {
      alg: algs.alg,
      keyId: formatKeyId(keyRef, version),
      sig: Buffer.from(res.Signature).toString('base64'),
    };
  }

  protected async loadPublicKey(
    keyRef: string,
    version: number,
  ): Promise<KeyObject | null> {
    let res;
    try {
      res = await this.client.send(
        new GetPublicKeyCommand({ KeyId: versionAlias(keyRef, version) }),
      );
    } catch (e) {
      if (e instanceof NotFoundException) return null;
      throw new KeyStoreException(`KMS GetPublicKey for ${keyRef} failed`, {
        cause: e,
      });
    }
    if (!res.PublicKey) return null;
    try {
      return createPublicKey({
        key: Buffer.from(res.PublicKey),
        format: 'der',
        type: 'spki',
      });
    } catch (e) {
      throw new KeyStoreException(
        `KMS key ${versionAlias(keyRef, version)} has an unreadable public key`,
        { cause: e },
      );
    }
  }

  private async versionOf(keyRef: string, keyArn: string): Promise<number> {
    const cached = this.versions.get(keyArn);
    if (cached) return cached;
    // At most 100 aliases per call; a signing key carries two or three
    const { Aliases = [] } = await kms('ListAliases', () =>
      this.client.send(new ListAliasesCommand({ KeyId: keyArn })),
    );
    const pattern = new RegExp(`^alias/${keyRef}-v([1-9]\\d{0,8})$`);
    const versions = Aliases.flatMap((a) => {
      const match = pattern.exec(a.AliasName ?? '');
      return match ? [Number(match[1])] : [];
    });
    if (versions.length !== 1)
      throw new KeyStoreException(
        `KMS key behind alias/${keyRef} needs exactly one alias alias/${keyRef}-v<n>`,
      );
    this.versions.set(keyArn, versions[0]);
    return versions[0];
  }
}

async function kms<T>(what: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (e) {
    throw new KeyStoreException(`KMS ${what} failed`, { cause: e });
  }
}
