import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { SigningKey } from '../../generated/prisma/client.js';
import { isSigningAlg } from './algorithm-registry.js';
import { SigningKeyDto } from './dto/signing-key.dto.js';
import { parseKeyId } from './key-id.js';
import { algOfKey } from './signature-algorithms.js';
import type { SigningAlg } from './signer.js';
import { decodePublicKey } from './public-key.js';

export interface ActivateSigningKeyInput {
  keyId: string;
  alg: SigningAlg;
  /** SPKI DER, standard base64. */
  publicKey: string;
  activatedAt?: Date;
}

function toDto(row: SigningKey): SigningKeyDto {
  return {
    keyId: row.keyId,
    version: row.version,
    alg: row.alg as SigningAlg,
    publicKey: row.publicKey,
    activatedAt: row.activatedAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Catalog of published signing public keys (2.6, 2.7). Private keys never enter this table.
 * Activation is used by rotation (A-B8.5); listing powers GET /v1/audit/keys.
 */
@Injectable()
export class SigningKeysService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every published key, oldest first (revoked ones stay so old signatures can still verify). */
  async list(): Promise<SigningKeyDto[]> {
    const rows = await this.prisma.signingKey.findMany({
      orderBy: [{ activatedAt: 'asc' }, { keyId: 'asc' }],
    });
    return rows.map(toDto);
  }

  async find(keyId: string): Promise<SigningKeyDto | null> {
    const row = await this.prisma.signingKey.findUnique({ where: { keyId } });
    return row ? toDto(row) : null;
  }

  /**
   * Publishes one key version. The public key must match `alg` and `keyId` must be a
   * versioned key name (`audit-signing:v1`).
   */
  async activate(input: ActivateSigningKeyInput): Promise<SigningKeyDto> {
    const parsed = parseKeyId(input.keyId);
    if (!parsed)
      throw new DomainException(
        'INVALID_KEY_ID',
        'keyId must look like audit-signing:v1.',
        400,
        [{ field: 'keyId', issue: 'must be <keyRef>:v<version>' }],
      );
    if (!isSigningAlg(input.alg))
      throw new DomainException(
        'INVALID_SIGNING_ALG',
        'alg must be a registered signing algorithm.',
        400,
        [{ field: 'alg', issue: 'unknown algorithm' }],
      );
    const key = decodePublicKey(input.publicKey);
    if (!key || algOfKey(key) !== input.alg)
      throw new DomainException(
        'INVALID_PUBLIC_KEY',
        'publicKey must be SPKI base64 for the named algorithm.',
        400,
        [{ field: 'publicKey', issue: 'not a valid public key for alg' }],
      );

    const row = await this.prisma.signingKey.create({
      data: {
        keyId: input.keyId,
        version: parsed.version,
        alg: input.alg,
        publicKey: input.publicKey,
        activatedAt: input.activatedAt ?? new Date(),
      },
    });
    return toDto(row);
  }

  /** Sets revokedAt once; used by A-B8.6. Fails if the key is missing or already revoked. */
  async revoke(
    keyId: string,
    revokedAt: Date = new Date(),
  ): Promise<SigningKeyDto> {
    try {
      return toDto(
        await this.prisma.signingKey.update({
          where: { keyId },
          data: { revokedAt },
        }),
      );
    } catch (e) {
      const existing = await this.prisma.signingKey.findUnique({
        where: { keyId },
      });
      if (!existing)
        throw new DomainException(
          'SIGNING_KEY_NOT_FOUND',
          'No published signing key with that keyId.',
          404,
          [{ field: 'keyId', issue: 'not found' }],
        );
      throw e;
    }
  }
}
