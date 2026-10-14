import { ApiProperty } from '@nestjs/swagger';
import { IsObject, Matches } from 'class-validator';

/**
 * The fields read from a provider event. Providers send more fields, so this is checked by
 * PaymentsService.parseEvent (unknown fields allowed), not by the global ValidationPipe.
 */
export class WebhookEventDto {
  @ApiProperty({
    example: 'evt_3PqR8s2eZvKYlo2C',
    description: 'Provider event id; a redelivery carries the same id',
    pattern: '^[A-Za-z0-9_.:-]{1,255}$',
  })
  @Matches(/^[A-Za-z0-9_.:-]{1,255}$/, {
    message: '$property must be 1-255 characters of A-Z a-z 0-9 _ . : -',
  })
  id: string;

  @ApiProperty({ example: 'payment.succeeded', pattern: '^[a-z0-9_.]{1,100}$' })
  @Matches(/^[a-z0-9_.]{1,100}$/, {
    message: '$property must be 1-100 characters of a-z 0-9 _ .',
  })
  type: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    example: {
      walletId: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70',
      amount: '250.00',
      currency: 'AED',
    },
  })
  @IsObject()
  data: Record<string, unknown>;
}
