import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, Matches } from 'class-validator';
import { CURRENCIES } from '../../../common/money/currency.js';
import { IsDecimalString } from '../../../common/money/decorators/is-decimal-string.decorator.js';

export class CreateWithdrawalDto {
  @ApiProperty({
    format: 'uuid',
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    description: "One of the caller's wallets",
  })
  @IsUUID()
  walletId: string;

  @ApiProperty({
    format: 'uuid',
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c',
    description: 'An active allow-listed destination',
  })
  @IsUUID()
  beneficiaryId: string;

  @ApiProperty({
    example: '10.00',
    description: 'Positive decimal string, at most the currency scale',
  })
  @IsDecimalString()
  amount: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsString()
  currency: string;

  @ApiProperty({
    example: '123456',
    description:
      'A fresh 6-digit TOTP code. Required on every payout, including an active destination. A code works once.',
  })
  @Matches(/^\d{6}$/, { message: 'totpCode must be a 6-digit code' })
  totpCode: string;
}
