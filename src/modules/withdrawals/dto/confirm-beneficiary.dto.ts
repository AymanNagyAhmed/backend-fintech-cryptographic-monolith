import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ConfirmBeneficiaryDto {
  @ApiProperty({
    example: '123456',
    description: 'Current TOTP code; required to confirm an allow-list entry',
  })
  @Matches(/^\d{6}$/, { message: 'totpCode must be a 6-digit code' })
  totpCode: string;
}
