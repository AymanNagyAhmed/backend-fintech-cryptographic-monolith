import { Module } from '@nestjs/common';
import { WebhookSignatureGuard } from './guards/webhook-signature.guard.js';
import { PaymentsService } from './payments.service.js';
import { WebhooksController } from './webhooks.controller.js';

/** Incoming payment provider webhooks (deposits); owns the payments schema. */
@Module({
  controllers: [WebhooksController],
  providers: [PaymentsService, WebhookSignatureGuard],
})
export class PaymentsModule {}
