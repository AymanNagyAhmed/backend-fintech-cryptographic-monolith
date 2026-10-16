import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import { CURRENCIES } from '../../../common/money/currency.js';

export class ProofQueryDto {
  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  @IsString()
  @IsIn([...CURRENCIES])
  currency: string;
}
