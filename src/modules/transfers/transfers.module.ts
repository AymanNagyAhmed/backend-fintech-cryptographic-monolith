import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WalletsModule } from '../wallets/wallets.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

// Writes ledger.transfers; wallets are resolved through WalletsService (no wallet models here)
@Module({
  imports: [IdempotencyModule, LedgerModule, WalletsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
