import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// The upper bound keeps argon2 input bounded; 128 characters leave room for passphrases
export const PASSWORD_MAX = 128;
export const TOTP_CODE_PATTERN = /^\d{6}$/;

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

  @ApiPropertyOptional({
    example: '123456',
    description:
      'Required once TOTP is enabled; privileged roles only apply to sessions that passed it',
  })
  @IsOptional()
  @Matches(TOTP_CODE_PATTERN, { message: '$property must be 6 digits' })
  totpCode?: string;
}
