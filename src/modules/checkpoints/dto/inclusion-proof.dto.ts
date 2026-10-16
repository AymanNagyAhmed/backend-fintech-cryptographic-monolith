import { ApiProperty } from '@nestjs/swagger';

export class InclusionProofDto {
  @ApiProperty({ format: 'uuid' })
  eventId!: string;

  @ApiProperty({ example: 0 })
  leafIndex!: number;

  @ApiProperty({ example: 16 })
  treeSize!: number;

  @ApiProperty({ description: 'Published STH root (hex)' })
  rootHash!: string;

  @ApiProperty({ description: 'RFC 6962 leaf hash (hex)' })
  leafHash!: string;

  @ApiProperty({ type: [String], description: 'Sibling hashes leaf→root' })
  path!: string[];

  @ApiProperty({ description: 'Server recomputed proof against STH root' })
  verified!: boolean;
}
