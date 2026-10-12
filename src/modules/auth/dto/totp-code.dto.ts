import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';
import { TOTP_CODE_PATTERN } from './login.dto.js';

export class TotpCodeDto {
  @ApiProperty({
    example: '123456',
    description: 'Current code of the authenticator app',
  })
  @Matches(TOTP_CODE_PATTERN, { message: '$property must be 6 digits' })
  code: string;
}
