import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TreeHeadDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 16 })
  treeSize!: number;

  @ApiProperty()
  rootHash!: string;

  @ApiProperty({ format: 'date-time' })
  timestamp!: string;

  @ApiPropertyOptional({ nullable: true })
  previousSthHash!: string | null;

  @ApiProperty({ example: 'ed25519' })
  alg!: string;

  @ApiProperty({ example: 'audit-signing:v1' })
  keyId!: string;

  @ApiProperty({ description: 'Detached signature (standard base64)' })
  signature!: string;

  @ApiProperty({ description: 'Whether an RFC 3161 token is stored' })
  hasTsaToken!: boolean;

  @ApiProperty({
    description:
      'True only after the RFC 3161 token for this head is stored. A signed head written while the TSA is down stays false.',
  })
  timeAnchored!: boolean;

  @ApiProperty({
    enum: ['ok', 'degraded', 'unknown'],
    description: 'Host clock vs NTP at STH write (A-B16.5 / 2.9)',
  })
  clockQuality!: 'ok' | 'degraded' | 'unknown';
}
