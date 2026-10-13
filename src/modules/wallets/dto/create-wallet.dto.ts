import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CURRENCIES } from '../../../common/money/currency.js';
import {
  WALLET_LABEL_INPUT_MAX,
  WALLET_LABEL_MAX_LENGTH,
} from '../wallet-label.js';

// currency is checked by WalletsService (UNSUPPORTED_CURRENCY 422 lists the supported ones);
// the label is trimmed and checked there too (INVALID_LABEL 422)
export class CreateWalletDto {
  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsString()
  currency: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'Savings',
    maxLength: WALLET_LABEL_MAX_LENGTH,
    description:
      'Trimmed; 1-50 characters, no control characters. Omitted or null = no label.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(WALLET_LABEL_INPUT_MAX)
  label?: string | null;
}
