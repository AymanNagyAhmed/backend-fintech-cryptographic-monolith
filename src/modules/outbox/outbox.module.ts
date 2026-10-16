import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { OutboxLagService } from './outbox-lag.service.js';
import { OutboxService } from './outbox.service.js';

// Reads/writes every context outbox (OWNERSHIP lists auth, wallet, ledger, payments).
// Business modules import this and call enqueue in their own transaction; they never
// touch another context's outbox table. Lag alerts do not block requests (A-B9.7).
// The dispatcher delivers rows to `@OnEvent('outbox.<type>')` handlers (A-B14.3); this is the
// only EventEmitterModule.forRoot (global, wildcard so `outbox.**` matches every type).
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.' })],
  providers: [OutboxService, OutboxLagService, OutboxDispatcherService],
  exports: [OutboxService, OutboxLagService, OutboxDispatcherService],
})
export class OutboxModule {}
