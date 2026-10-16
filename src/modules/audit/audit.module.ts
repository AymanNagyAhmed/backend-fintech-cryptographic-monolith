import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AuditAccessService } from './audit-access.service.js';
import { ChainerService } from './chainer.service.js';

// Owns audit.audit_events. ChainerService is also provided by AuditJobsModule for workers.
@Module({
  imports: [OutboxModule],
  providers: [ChainerService, AuditAccessService],
  exports: [ChainerService, AuditAccessService],
})
export class AuditModule {}

