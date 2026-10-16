import { Module } from '@nestjs/common';
import { OutboxService } from './outbox.service.js';

// Reads/writes every context outbox (OWNERSHIP lists auth, wallet, ledger, payments).
// Business modules import this and call enqueue in their own transaction; they never
// touch another context's outbox table.
@Module({
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
