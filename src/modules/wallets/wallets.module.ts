import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

// PrismaService comes from the global DatabaseModule; balances come from LedgerService
@Module({
  imports: [LedgerModule],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
