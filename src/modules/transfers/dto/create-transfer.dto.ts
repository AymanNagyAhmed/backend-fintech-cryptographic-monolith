import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID } from 'class-validator';
import { CURRENCIES } from '../../../common/money/currency.js';
import { IsDecimalString } from '../../../common/money/decorators/is-decimal-string.decorator.js';

// The currency scale of amount and the currency itself are checked by TransfersService
// (INVALID_AMOUNT, UNSUPPORTED_CURRENCY, CURRENCY_MISMATCH 422)
export class CreateTransferDto {
  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    format: 'uuid',
    description: "One of the caller's wallets",
  })
  @IsUUID()
  fromWalletId: string;

  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c',
    format: 'uuid',
    description: 'A wallet in the same currency, also of another user',
  })
  @IsUUID()
  toWalletId: string;

  @ApiProperty({
    example: '10.00',
    description:
      'Positive decimal string, at most the currency scale (BTC: 8 decimals)',
  })
  @IsDecimalString()
  amount: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsString()
  currency: string;
}
