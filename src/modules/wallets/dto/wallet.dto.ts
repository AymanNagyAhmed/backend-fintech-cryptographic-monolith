import { ApiProperty } from '@nestjs/swagger';
import { CURRENCIES, type Currency } from '../../../common/money/currency.js';
import { WalletStatus } from '../../../generated/prisma/client.js';

// Owner and ledger account ids stay internal
export class WalletDto {
  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  currency: Currency;

  @ApiProperty({ type: String, nullable: true, example: 'Savings' })
  label: string | null;

  @ApiProperty({ enum: WalletStatus, example: WalletStatus.active })
  status: WalletStatus;

  @ApiProperty({
    example: '1500.00',
    description: 'Decimal string at the currency scale (BTC: 8 decimals)',
  })
  balance: string;

  @ApiProperty({ example: '2026-10-13T18:30:00.000Z', format: 'date-time' })
  createdAt: string;

  @ApiProperty({ example: '2026-10-13T18:30:00.000Z', format: 'date-time' })
  updatedAt: string;
}
