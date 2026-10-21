import { ApiProperty } from '@nestjs/swagger';

export class WithdrawalDto {
  @ApiProperty({
    example: 'withdrawal:019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5d',
    description: 'Ledger posting ref for this payout',
  })
  id: string;

  @ApiProperty({ format: 'uuid' })
  walletId: string;

  @ApiProperty({ format: 'uuid' })
  beneficiaryId: string;

  @ApiProperty({ example: '10.00' })
  amount: string;

  @ApiProperty({ example: 'AED' })
  currency: string;

  @ApiProperty({ example: 'COMPLETED' })
  status: 'COMPLETED';
}
