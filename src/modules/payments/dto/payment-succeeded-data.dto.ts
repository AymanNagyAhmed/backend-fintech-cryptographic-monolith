import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import { CURRENCIES, type Currency } from '../../../common/money/currency.js';
import { IsDecimalString } from '../../../common/money/decorators/is-decimal-string.decorator.js';

/** `data` of a `payment.succeeded` event: money that arrived for one wallet. */
export class PaymentSucceededDataDto {
  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70',
    format: 'uuid',
    description: 'Wallet to credit (any user)',
  })
  @IsUUID()
  walletId: string;

  @ApiProperty({
    example: '250.00',
    description:
      'Positive decimal string, at most the currency scale (BTC: 8 decimals)',
  })
  @IsDecimalString()
  amount: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsIn(CURRENCIES)
  currency: Currency;
}
