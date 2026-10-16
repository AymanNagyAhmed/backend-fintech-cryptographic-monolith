import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BeneficiaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  label: string;

  @ApiProperty({ example: 'BTC' })
  currency: string;

  @ApiProperty()
  address: string;

  @ApiProperty({ example: 'bitcoin' })
  network: string;

  @ApiProperty({
    enum: ['pending_confirmation', 'confirmed', 'revoked'],
  })
  status: string;

  @ApiProperty({
    description:
      'True when status is confirmed, activeAt has passed, and not revoked',
  })
  active: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  confirmedAt: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  activeAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}
