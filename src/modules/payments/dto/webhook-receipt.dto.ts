import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CURRENCIES } from '../../../common/money/currency.js';
import { WEBHOOK_PROVIDER_NAMES } from '../webhook-providers.js';

export const WEBHOOK_OUTCOMES = ['credited', 'rejected', 'ignored'] as const;
export type WebhookOutcome = (typeof WEBHOOK_OUTCOMES)[number];

export const DEPOSIT_REJECTION_CODES = [
  'WALLET_NOT_FOUND',
  'CURRENCY_MISMATCH',
  'ACCOUNT_FROZEN',
  'ACCOUNT_CLOSED',
] as const;
export type DepositRejectionCode = (typeof DEPOSIT_REJECTION_CODES)[number];

export class WebhookDepositDto {
  @ApiProperty({ example: '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a70' })
  walletId: string;

  @ApiProperty({ example: '250.00' })
  amount: string;

  @ApiProperty({ enum: CURRENCIES, example: 'AED' })
  currency: string;
}

export class WebhookRejectionDto {
  @ApiProperty({ enum: DEPOSIT_REJECTION_CODES, example: 'ACCOUNT_FROZEN' })
  code: DepositRejectionCode;

  @ApiProperty({ example: 'The wallet is frozen.' })
  message: string;
}

export class WebhookReceiptDto {
  @ApiProperty({ example: 'stripe', enum: WEBHOOK_PROVIDER_NAMES })
  provider: string;

  @ApiProperty({ example: 'evt_3PqR8s2eZvKYlo2C' })
  eventId: string;

  @ApiProperty({ example: 'payment.succeeded' })
  type: string;

  @ApiProperty({
    enum: WEBHOOK_OUTCOMES,
    example: 'credited',
    description:
      'credited: the wallet got the amount; rejected: cannot be credited, kept for manual review; ignored: event type without an action',
  })
  status: WebhookOutcome;

  @ApiPropertyOptional({
    type: WebhookDepositDto,
    description: 'The requested deposit (payment.succeeded only)',
  })
  deposit?: WebhookDepositDto;

  @ApiPropertyOptional({
    type: WebhookRejectionDto,
    description: 'Why a deposit was rejected',
  })
  reason?: WebhookRejectionDto;
}
