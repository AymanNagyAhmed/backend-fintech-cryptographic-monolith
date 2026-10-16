import { createPublicKey, type KeyObject } from 'node:crypto';
import { KeyStoreException } from '../exceptions/key-store.exception.js';
import { formatKeyId } from '../key-id.js';
import type { SignatureEnvelope, SigningAlg } from '../signer.js';
import { KeyStoreSigner } from './key-store.signer.js';

const TIMEOUT_MS = 5000;

/** Transit key types that can sign, by our algorithm name (OpenBao 2.7 has no ML-DSA). */
const ALG_OF_KEY_TYPE: Readonly<Record<string, SigningAlg>> = {
  ed25519: 'ed25519',
  'ecdsa-p256': 'ecdsa-p256',
};

/** `vault:v<version>:<base64>`, the Transit signature format. */
const TRANSIT_SIGNATURE = /^vault:v([1-9]\d{0,8}):([A-Za-z0-9+/]+={0,2})$/;

interface TransitKey {
  type: string;
  keys: Record<string, { public_key?: string }>;
}

/**
 * Dev adapter: OpenBao Transit over its HTTP API (2.6). Signs with POST transit/sign/<key>
 * (latest version; ECDSA with the defaults sha2-256 and ASN.1 DER) and reads public keys from
 * GET transit/keys/<key>. Needs a token with `update` on transit/sign/<key> and `read` on
 * transit/keys/<key>. Errors never include the token.
 */
export class OpenBaoTransitSigner extends KeyStoreSigner {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {
    super();
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope> {
    const key = await this.readKey(keyRef);
    if (!key) throw new KeyStoreException(`Transit key ${keyRef} not found`);
    const alg = algOf(keyRef, key);
    const data = await this.request<{
      signature?: string;
      key_version?: number;
    }>('POST', `transit/sign/${encodeURIComponent(keyRef)}`, {
      input: Buffer.from(bytes).toString('base64'),
    });
    const match = TRANSIT_SIGNATURE.exec(data?.signature ?? '');
    if (!match || Number(match[1]) !== data?.key_version)
      throw new KeyStoreException(
        `Transit returned an unexpected signature for ${keyRef}`,
      );
    return {
      alg,
      keyId: formatKeyId(keyRef, Number(match[1])),
      sig: match[2],
    };
  }

  protected async loadPublicKey(
    keyRef: string,
    version: number,
  ): Promise<KeyObject | null> {
    const key = await this.readKey(keyRef);
    const encoded = key?.keys[String(version)]?.public_key;
    if (!key || !encoded) return null;
    const alg = algOf(keyRef, key);
    try {
      // Ed25519 public keys come as 32 raw bytes, ECDSA ones as PEM
      return alg === 'ed25519'
        ? createPublicKey({
            key: {
              kty: 'OKP',
              crv: 'Ed25519',
              x: Buffer.from(encoded, 'base64').toString('base64url'),
            },
            format: 'jwk',
          })
        : createPublicKey(encoded);
    } catch (e) {
      throw new KeyStoreException(
        `Transit key ${keyRef} v${version} has an unreadable public key`,
        { cause: e },
      );
    }
  }

  private readKey(keyRef: string): Promise<TransitKey | null> {
    return this.request<TransitKey>(
      'GET',
      `transit/keys/${encodeURIComponent(keyRef)}`,
    );
  }

  /** `data` of the response; null for 404 (no such key). */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T | null> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/v1/${path}`, {
        method,
        headers: {
          'X-Vault-Token': this.token,
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new KeyStoreException(`OpenBao ${method} ${path} failed`, {
        cause: e,
      });
    }
    if (res.status === 404) return null;
    const json = (await res.json().catch(() => null)) as {
      data?: T;
      errors?: unknown[];
    } | null;
    if (!res.ok || !json?.data) {
      const reason = Array.isArray(json?.errors)
        ? `: ${String(json.errors[0]).slice(0, 200)}`
        : '';
      throw new KeyStoreException(
        `OpenBao ${method} ${path} answered HTTP ${res.status}${reason}`,
      );
    }
    return json.data;
  }
}

function algOf(keyRef: string, key: TransitKey): SigningAlg {
  const alg = Object.hasOwn(ALG_OF_KEY_TYPE, key.type)
    ? ALG_OF_KEY_TYPE[key.type]
    : undefined;
  if (!alg)
    throw new KeyStoreException(
      `Transit key ${keyRef} has type ${key.type}, which cannot sign here`,
    );
  return alg;
}
