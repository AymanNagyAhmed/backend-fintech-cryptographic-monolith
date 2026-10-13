import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
  type KeyObject,
} from 'node:crypto';
import { SecretBox } from '../../../common/crypto/secret-box.js';
import { DomainException } from '../../../common/exceptions/domain.exception.js';
import { CLIENT_ID_PATTERN } from '../../../common/request-signing/canonical-request.js';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { Prisma } from '../../../generated/prisma/client.js';
import type { ApiClientRef } from '../auth.types.js';

export const API_SIGNING_ALGORITHMS = ['hmac_sha256', 'ed25519'] as const;
export type ApiSigningAlgorithm = (typeof API_SIGNING_ALGORITHMS)[number];

export const HMAC_SECRET_PREFIX = 'b2b_';

export type CreateApiClientInput =
  | { clientId: string; name: string; algorithm: 'hmac_sha256' }
  | {
      clientId: string;
      name: string;
      algorithm: 'ed25519';
      publicKey: KeyObject;
    };

export interface CreatedApiClient extends ApiClientRef {
  algorithm: ApiSigningAlgorithm;
  /** HMAC clients only: shown once, only its ciphertext is stored. */
  secret?: string;
}

/** An active client that can check a signature over a canonical request. */
export interface ApiClientVerifier extends ApiClientRef {
  verify(canonical: string, signature: Buffer): boolean;
}

const invalidInput = (field: string, issue: string) =>
  new DomainException(
    'VALIDATION_FAILED',
    'Invalid API client.',
    HttpStatus.BAD_REQUEST,
    [{ field, issue }],
  );

const ed25519FromX = (x: string) =>
  createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' });

@Injectable()
export class ApiClientsService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.box = new SecretBox(
      config.get('API_CLIENT_ENCRYPTION_KEY', { infer: true }),
    );
  }

  async create(input: CreateApiClientInput): Promise<CreatedApiClient> {
    if (!CLIENT_ID_PATTERN.test(input.clientId))
      throw invalidInput('clientId', `must match ${CLIENT_ID_PATTERN}`);
    if (!input.name.trim()) throw invalidInput('name', 'must not be empty');

    let secret: string | undefined;
    let key: { secretEnc: string } | { publicKey: string };
    if (input.algorithm === 'hmac_sha256') {
      secret = `${HMAC_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
      key = { secretEnc: this.box.seal(Buffer.from(secret), input.clientId) };
    } else {
      if (input.publicKey.asymmetricKeyType !== 'ed25519')
        throw invalidInput('publicKey', 'must be an Ed25519 public key');
      key = { publicKey: input.publicKey.export({ format: 'jwk' }).x! };
    }

    try {
      const row = await this.prisma.apiClient.create({
        data: {
          clientId: input.clientId,
          name: input.name.trim(),
          algorithm: input.algorithm,
          ...key,
        },
        select: { id: true, clientId: true },
      });
      return {
        ...row,
        algorithm: input.algorithm,
        ...(secret ? { secret } : {}),
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      )
        throw new DomainException(
          'CLIENT_ID_TAKEN',
          'An API client with this id already exists.',
          HttpStatus.CONFLICT,
        );
      throw e;
    }
  }

  /** Revokes once; later signatures of the client are rejected. False if unknown or revoked. */
  async revoke(clientId: string): Promise<boolean> {
    const { count } = await this.prisma.apiClient.updateMany({
      where: { clientId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count === 1;
  }

  async findVerifier(clientId: string): Promise<ApiClientVerifier | null> {
    const row = await this.prisma.apiClient.findUnique({ where: { clientId } });
    if (!row || row.revokedAt) return null;
    const ref = { id: row.id, clientId: row.clientId };

    if (row.algorithm === 'hmac_sha256') {
      const secret = this.box.open(row.secretEnc!, row.clientId);
      return {
        ...ref,
        verify: (canonical, signature) => {
          const expected = createHmac('sha256', secret)
            .update(canonical)
            .digest();
          return (
            signature.length === expected.length &&
            timingSafeEqual(signature, expected)
          );
        },
      };
    }
    const publicKey = ed25519FromX(row.publicKey!);
    return {
      ...ref,
      verify: (canonical, signature) =>
        verify(null, Buffer.from(canonical), publicKey, signature),
    };
  }
}
