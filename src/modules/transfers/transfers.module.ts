import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { OutboxModule } from '../outbox/outbox.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

// Writes ledger.transfers + ledger.outbox (via OutboxService); wallets through WalletsService
@Module({
  imports: [IdempotencyModule, LedgerModule, WalletsModule, OutboxModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
