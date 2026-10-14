import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard.js';
import { PaymentsService } from './payments.service.js';
import { WebhooksController } from './webhooks.controller.js';

/** Incoming payment provider webhooks (deposits); owns the payments schema, wallets via WalletsService. */
@Module({
  imports: [IdempotencyModule, LedgerModule, WalletsModule],
  controllers: [WebhooksController],
  providers: [PaymentsService, WebhookSignatureGuard],
})
export class PaymentsModule {}
