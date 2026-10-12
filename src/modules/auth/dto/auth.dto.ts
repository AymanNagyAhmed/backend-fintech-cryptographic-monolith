import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { REFRESH_TOKEN_PATTERN } from '../token.service.js';

// The upper bound keeps argon2 input bounded; 128 characters leave room for passphrases
const PASSWORD_MAX = 128;

export class RegisterDto {
  @ApiProperty({ example: 'alice@example.com', maxLength: 254 })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({
    example: 'S3cure!pass-123',
    minLength: 12,
    maxLength: PASSWORD_MAX,
  })
  @IsString()
  @MinLength(12)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

// No length policy on login beyond the bound: the stored hash decides
export class LoginDto {
  @ApiProperty({ example: 'alice@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty({ example: 'S3cure!pass-123' })
  @IsString()
  @MinLength(1)
  @MaxLength(PASSWORD_MAX)
  password: string;
}

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
