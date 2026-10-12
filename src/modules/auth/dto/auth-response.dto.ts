import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from '../auth.types.js';

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
}

export class UserProfileDto {
  @ApiProperty({
    example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b',
    format: 'uuid',
  })
  id: string;

  @ApiProperty({ example: 'alice@example.com' })
  email: string;

  @ApiProperty({ enum: ROLES, isArray: true, example: ['user'] })
  roles: Role[];

  @ApiProperty({ enum: ['active', 'locked', 'disabled'], example: 'active' })
  status: string;

  @ApiProperty({ example: '2026-10-12T18:30:00.000Z', format: 'date-time' })
  createdAt: string;
}

export class LogoutResultDto {
  @ApiProperty({ example: true })
  loggedOut: true;
}
