import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX } from './login.dto.js';

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
