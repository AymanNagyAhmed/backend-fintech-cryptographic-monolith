import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { ALGORITHM_REGISTRY, isSigningAlg } from './algorithm-registry.js';
import { SignerContractException } from './exceptions/signer-contract.exception.js';
import { isKeyRef, parseKeyId } from './key-id.js';
import {
  SIGNER_BACKEND,
  type SignatureEnvelope,
  type Signer,
  type SigningAlg,
} from './signer.js';
import { SigningKeysService } from './signing-keys.service.js';

/** Decoded bytes of a canonical standard-base64 signature with the algorithm's length, else null. */
function signatureBytes(alg: SigningAlg, sig: unknown): Buffer | null {
  if (typeof sig !== 'string' || sig.length === 0) return null;
  const bytes = Buffer.from(sig, 'base64');
  const { min, max } = ALGORITHM_REGISTRY[alg].signatureBytes;
  if (bytes.toString('base64') !== sig) return null;
  return bytes.length >= min && bytes.length <= max ? bytes : null;
}

/**
 * Time evidence for one signed artifact. `signedAt` is the timestamp inside that
 * artifact (the STH payload), not the server clock. `anchored` is true only when
 * that artifact's RFC 3161 token is already stored.
 */
export interface AnchoredSignature {
  signedAt: Date;
  anchored: boolean;
}

/** A revoked key still covers an artifact signed strictly before `revokedAt` once the token is stored. */
function coveredBeforeRevocation(
  revokedAtIso: string,
  anchor: AnchoredSignature | undefined,
): boolean {
  if (anchor?.anchored !== true || !(anchor.signedAt instanceof Date))
    return false;
  const signedAt = anchor.signedAt.getTime();
  const revokedAt = new Date(revokedAtIso).getTime();
  if (Number.isNaN(signedAt) || Number.isNaN(revokedAt)) return false;
  return signedAt < revokedAt;
}

/** Only the three envelope fields, so nothing else an adapter returns is ever stored. */
function wellFormed(value: unknown): SignatureEnvelope | null {
  if (typeof value !== 'object' || value === null) return null;
  const { alg, keyId, sig } = value as Record<string, unknown>;
  if (!isSigningAlg(alg) || !parseKeyId(keyId) || !signatureBytes(alg, sig))
    return null;
  return { alg, keyId: keyId as string, sig: sig as string };
}

/**
 * What the rest of the application signs and verifies with (2.6, 2.7). Wraps the configured
 * adapter and holds every adapter to the same contract: a new signature must use SIGNING_ALG
 * and name the requested key with a version; a malformed signature never reaches an adapter
 * and verifies as false. Verification accepts any registered algorithm so a config switch
 * keeps older artifacts verifiable. A key with `revokedAt` set in `crypto.signing_keys`
 * is refused on a live check. A stored RFC 3161 token still verifies an artifact whose
 * own timestamp is strictly before that `revokedAt`.
 */
@Injectable()
export class SignerService implements Signer {
  private readonly signingAlg: SigningAlg;

  constructor(
    @Inject(SIGNER_BACKEND) private readonly backend: Signer,
    private readonly signingKeys: SigningKeysService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.signingAlg = config.get('SIGNING_ALG', { infer: true });
  }

  async sign(bytes: Uint8Array, keyRef: string): Promise<SignatureEnvelope> {
    if (!isKeyRef(keyRef))
      throw new Error(`Invalid key name: ${JSON.stringify(keyRef)}`);
    const result = await this.backend.sign(bytes, keyRef);
    const envelope = wellFormed(result);
    if (!envelope)
      throw new SignerContractException('malformed signature envelope');
    if (parseKeyId(envelope.keyId)?.keyRef !== keyRef)
      throw new SignerContractException(
        `signed with ${envelope.keyId}, not a version of ${keyRef}`,
      );
    if (envelope.alg !== this.signingAlg)
      throw new SignerContractException(
        `signed with ${envelope.alg}, configured SIGNING_ALG is ${this.signingAlg}`,
      );
    return envelope;
  }

  async verify(
    bytes: Uint8Array,
    signature: SignatureEnvelope,
    anchor?: AnchoredSignature,
  ): Promise<boolean> {
    const envelope = wellFormed(signature);
    if (!envelope) return false;
    const published = await this.signingKeys.find(envelope.keyId);
    if (
      published?.revokedAt != null &&
      !coveredBeforeRevocation(published.revokedAt, anchor)
    )
      return false;
    return (await this.backend.verify(bytes, envelope)) === true;
  }
}
