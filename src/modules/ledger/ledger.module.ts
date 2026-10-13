import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';

// PrismaService comes from the global DatabaseModule
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
