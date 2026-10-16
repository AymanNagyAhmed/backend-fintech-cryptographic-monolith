import { Module } from '@nestjs/common';
import { OutboxLagService } from './outbox-lag.service.js';
import { OutboxService } from './outbox.service.js';

// Reads/writes every context outbox (OWNERSHIP lists auth, wallet, ledger, payments).
// Business modules import this and call enqueue in their own transaction; they never
// touch another context's outbox table. Lag alerts do not block requests (A-B9.7).
@Module({
  providers: [OutboxService, OutboxLagService],
  exports: [OutboxService, OutboxLagService],
})
export class OutboxModule {}

