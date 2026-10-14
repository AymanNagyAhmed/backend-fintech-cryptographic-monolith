import { ApiProperty } from '@nestjs/swagger';
import { WEBHOOK_PROVIDER_NAMES } from '../webhook-providers.js';

export class WebhookReceiptDto {
  @ApiProperty({ example: 'stripe', enum: WEBHOOK_PROVIDER_NAMES })
  provider: string;

  @ApiProperty({ example: 'evt_3PqR8s2eZvKYlo2C' })
  eventId: string;

  @ApiProperty({ example: 'payment.succeeded' })
  type: string;

  @ApiProperty({ example: 'received', enum: ['received'] })
  status: 'received';
}
