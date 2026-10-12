import { ApiProperty } from '@nestjs/swagger';

export class TokenPairDto {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' })
  accessToken: string;

  @ApiProperty({
    example: 'q8Jk0Vn3m6v5yQ0b8R2xT1c4Zp7Lw9Hs3Df6Gj1Ka2E',
    description:
      'Single use: each refresh returns a new one; reusing an old one revokes the session',
  })
  refreshToken: string;

  @ApiProperty({ example: 'Bearer' })
  tokenType: 'Bearer';

  @ApiProperty({
    example: 900,
    description: 'Access token lifetime in seconds',
  })
  expiresIn: number;

  @ApiProperty({
    example: false,
    description:
      'The login passed TOTP; without it privileged roles are not applied',
  })
  mfa: boolean;
}
