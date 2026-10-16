import { ApiProperty } from '@nestjs/swagger';

class ReservesProofPathStepDto {
  @ApiProperty({ description: 'Sibling hash (hex SHA-256)' })
  hash: string;

  @ApiProperty({ description: 'Sibling subtree sum (decimal string)' })
  sum: string;
}

export class ReservesProofDto {
  @ApiProperty({ format: 'uuid' })
  snapshotId: string;

  @ApiProperty({ example: 'AED' })
  currency: string;

  @ApiProperty({ example: '2026-10-16' })
  snapshotDate: string;

  @ApiProperty({ example: 42 })
  treeSize: number;

  @ApiProperty({ description: 'Published Merkle-sum root (hex)' })
  rootHash: string;

  @ApiProperty({ example: '10000.00' })
  totalLiabilities: string;

  @ApiProperty()
  leafIndex: number;

  @ApiProperty({ example: '100.00' })
  balance: string;

  @ApiProperty({ description: 'Per-leaf salt (hex); private to the owner' })
  salt: string;

  @ApiProperty({ type: [ReservesProofPathStepDto] })
  path: ReservesProofPathStepDto[];
}
