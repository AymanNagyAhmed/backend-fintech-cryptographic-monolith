import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class B2bPongDto {
  @ApiProperty({ example: 'dev-client' })
  clientId: string;

  @ApiPropertyOptional({ example: 'hello' })
  message?: string;

  @ApiProperty({ example: '2026-10-13T16:30:00.000Z' })
  receivedAt: string;
}
