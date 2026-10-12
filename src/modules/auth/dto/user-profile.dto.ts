import { ApiProperty } from '@nestjs/swagger';
import { ROLES, type Role } from '../auth.types.js';

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

  @ApiProperty({ example: false })
  totpEnabled: boolean;

  @ApiProperty({ example: '2026-10-12T18:30:00.000Z', format: 'date-time' })
  createdAt: string;
}
