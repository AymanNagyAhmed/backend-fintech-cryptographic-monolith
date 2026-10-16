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

/** Decoded bytes of a canonical standard-base64 signature with the algorithm's length, else null. */
function signatureBytes(alg: SigningAlg, sig: unknown): Buffer | null {
  if (typeof sig !== 'string' || sig.length === 0) return null;
  const bytes = Buffer.from(sig, 'base64');
  const { min, max } = ALGORITHM_REGISTRY[alg].signatureBytes;
  if (bytes.toString('base64') !== sig) return null;
  return bytes.length >= min && bytes.length <= max ? bytes : null;
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
 * keeps older artifacts verifiable.
 */
@Injectable()
export class SignerService implements Signer {
  private readonly signingAlg: SigningAlg;

  constructor(
    @Inject(SIGNER_BACKEND) private readonly backend: Signer,
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
  ): Promise<boolean> {
    const envelope = wellFormed(signature);
    if (!envelope) return false;
    return (await this.backend.verify(bytes, envelope)) === true;
  }
}
