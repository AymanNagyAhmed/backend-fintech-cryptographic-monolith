import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../../common/money/currency.js';

export const TRANSFER_STATUSES = ['COMPLETED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

// Ledger account ids, the posting ref and the initiator stay internal
export class TransferDto {
  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a60',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    format: 'uuid',
  })
  fromWalletId: string;

  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c',
    format: 'uuid',
  })
  toWalletId: string;

  @ApiProperty({
    example: '10.00',
    description: 'Decimal string at the currency scale',
  })
  amount: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  currency: Currency;

  @ApiProperty({
    enum: TRANSFER_STATUSES,
    example: 'COMPLETED',
    description:
      'A transfer commits with its ledger posting, so it is always COMPLETED',
  })
  status: TransferStatus;

  @ApiProperty({ example: '2026-10-14T18:30:00.000Z', format: 'date-time' })
  createdAt: string;
}
