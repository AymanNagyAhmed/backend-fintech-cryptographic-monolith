import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import { REFRESH_TOKEN_PATTERN } from '../token.service.js';

export class RefreshTokenDto {
  @ApiProperty({
    example: 'q8Jk0Vn3m6v5yQ0b8R2xT1c4Zp7Lw9Hs3Df6Gj1Ka2E',
    description:
      'Opaque refresh token from login or the previous refresh (43 base64url characters)',
  })
  @IsString()
  @Matches(REFRESH_TOKEN_PATTERN, { message: '$property is malformed' })
  refreshToken: string;
}
