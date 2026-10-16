import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { ChainerService } from './chainer.service.js';

// Owns audit.audit_events. ChainerService is also provided by AuditJobsModule for workers.
@Module({
  imports: [OutboxModule],
  providers: [ChainerService],
  exports: [ChainerService],
})
export class AuditModule {}
