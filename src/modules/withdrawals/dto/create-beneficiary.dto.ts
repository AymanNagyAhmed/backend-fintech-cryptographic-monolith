import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CURRENCIES } from '../../../common/money/currency.js';

export class CreateBeneficiaryDto {
  @ApiProperty({ example: 'Cold wallet', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  label: string;

  @ApiProperty({ enum: CURRENCIES, example: 'BTC' })
  @IsString()
  currency: string;

  @ApiProperty({
    example: 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh',
    description:
      'Bech32 or base58check address, or a bank reference when network starts with bank_',
    maxLength: 256,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  address: string;

  @ApiProperty({
    example: 'bitcoin',
    description: 'Network or rail (bitcoin, ethereum, bank_aed, ...)',
    maxLength: 64,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  network: string;
}
