import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { OpenBaoTransitSigner } from './adapters/openbao-transit.signer.js';
import type { SigningKeyDto } from './dto/signing-key.dto.js';
import { formatKeyId, isKeyRef } from './key-id.js';
import { encodePublicKey } from './public-key.js';
import type { SigningAlg } from './signer.js';
import { SigningKeysService } from './signing-keys.service.js';

export interface KeyRotationResult {
  keyRef: string;
  alg: SigningAlg;
  latestVersion: number;
  /** Versions newly written to `crypto.signing_keys` in this call. */
  published: SigningKeyDto[];
}

/**
 * Rotates the OpenBao Transit signing key and publishes any missing public key
 * versions into `crypto.signing_keys` (2.6, A-B8.5). Private keys never leave OpenBao.
 */
@Injectable()
export class KeyRotationService {
  constructor(
    private readonly store: OpenBaoTransitSigner,
    private readonly keys: SigningKeysService,
  ) {}

  /**
   * Advances Transit to the next version, then publishes every version that is
   * not yet in `crypto.signing_keys` (including older ones still missing).
   */
  async rotate(keyRef: string): Promise<KeyRotationResult> {
    if (!isKeyRef(keyRef))
      throw new Error(`Invalid key name: ${JSON.stringify(keyRef)}`);
    await this.store.rotate(keyRef);
    return this.publishMissing(keyRef);
  }

  /** Publishes Transit public keys that are not yet in the catalog (no rotate). */
  async publishMissing(keyRef: string): Promise<KeyRotationResult> {
    if (!isKeyRef(keyRef))
      throw new Error(`Invalid key name: ${JSON.stringify(keyRef)}`);
    const { alg, versions } = await this.store.publicVersions(keyRef);
    const published: SigningKeyDto[] = [];
    for (const v of versions) {
      const keyId = formatKeyId(keyRef, v.version);
      if (await this.keys.find(keyId)) continue;
      published.push(
        await this.keys.activate({
          keyId,
          alg,
          publicKey: encodePublicKey(v.publicKey),
          activatedAt: v.activatedAt,
        }),
      );
    }
    return {
      keyRef,
      alg,
      latestVersion: versions.at(-1)?.version ?? 0,
      published,
    };
  }
}

/** Nest factory: rotation always talks to OpenBao (ops path), not the SIGNER_BACKEND adapter. */
export const keyRotationProvider = {
  provide: KeyRotationService,
  inject: [ConfigService, SigningKeysService],
  useFactory: (
    config: ConfigService<EnvironmentVariables, true>,
    keys: SigningKeysService,
  ) =>
    new KeyRotationService(
      new OpenBaoTransitSigner(
        config.get('BAO_ADDR', { infer: true }),
        // Prefer BAO_ADMIN_TOKEN so BAO_TOKEN can be the narrow audit-signer policy (A-B8.8).
        config.get('BAO_ADMIN_TOKEN', { infer: true }) ??
          config.get('BAO_TOKEN', { infer: true }),
      ),
      keys,
    ),
};
