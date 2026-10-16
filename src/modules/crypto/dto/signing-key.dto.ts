import { ApiProperty } from '@nestjs/swagger';
import { SIGNING_ALGS } from '../../../config/env.validation.js';
import type { SigningAlg } from '../signer.js';

export class SigningKeyDto {
  @ApiProperty({
    example: 'audit-signing:v1',
    description: 'Key name and version as every signature stores it',
  })
  keyId: string;

  @ApiProperty({ example: 1, minimum: 1 })
  version: number;

  @ApiProperty({ enum: SIGNING_ALGS, example: 'ed25519' })
  alg: SigningAlg;

  @ApiProperty({
    example: 'MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=',
    description: 'SPKI DER public key, standard base64 (never a private key)',
  })
  publicKey: string;

  @ApiProperty({ example: '2026-10-16T17:00:00.000Z', format: 'date-time' })
  activatedAt: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: null,
    format: 'date-time',
  })
  revokedAt: string | null;
}

export class SigningKeyPageDto {
  @ApiProperty({ type: [SigningKeyDto] })
  items: SigningKeyDto[];
}
