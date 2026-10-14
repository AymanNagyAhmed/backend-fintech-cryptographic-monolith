import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';
import { ReconciliationService } from './reconciliation.service.js';

// PrismaService comes from the global DatabaseModule
@Module({
  providers: [LedgerService, ReconciliationService],
  exports: [LedgerService, ReconciliationService],
})
export class LedgerModule {}
