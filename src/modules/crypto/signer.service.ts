import { Inject, Injectable } from '@nestjs/common';
import { SIGNING_ALGS } from '../../config/env.validation.js';
import { SignerContractException } from './exceptions/signer-contract.exception.js';
import { isKeyRef, parseKeyId } from './key-id.js';
import {
  SIGNATURE_BYTES,
  SIGNER_BACKEND,
  type SignatureEnvelope,
  type Signer,
  type SigningAlg,
} from './signer.js';

const isSigningAlg = (value: unknown): value is SigningAlg =>
  (SIGNING_ALGS as readonly unknown[]).includes(value);

/** Decoded bytes of a canonical standard-base64 signature with the algorithm's length, else null. */
function signatureBytes(alg: SigningAlg, sig: unknown): Buffer | null {
  if (typeof sig !== 'string' || sig.length === 0) return null;
  const bytes = Buffer.from(sig, 'base64');
  const { min, max } = SIGNATURE_BYTES[alg];
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
 * What the rest of the application signs and verifies with (2.6). Wraps the configured adapter
 * and holds every adapter to the same contract: a signature names the requested key with a
 * version and has the length of its algorithm; a malformed signature never reaches an adapter
 * and verifies as false.
 */
@Injectable()
export class SignerService implements Signer {
  constructor(@Inject(SIGNER_BACKEND) private readonly backend: Signer) {}

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
