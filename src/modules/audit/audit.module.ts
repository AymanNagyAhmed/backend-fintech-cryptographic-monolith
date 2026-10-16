import { Module } from '@nestjs/common';
import { OutboxModule } from '../outbox/outbox.module.js';
import { AuditAccessService } from './audit-access.service.js';
import { AuditController } from './audit.controller.js';
import { AuditOutboxHandler } from './audit-outbox.handler.js';
import { ChainerService } from './chainer.service.js';
import { VerifyService } from './verify.service.js';

// Owns audit.audit_events. ChainerService is also provided by AuditJobsModule for workers.
@Module({
  imports: [OutboxModule],
  controllers: [AuditController],
  providers: [
    ChainerService,
    AuditOutboxHandler,
    AuditAccessService,
    VerifyService,
  ],
  exports: [ChainerService, AuditAccessService, VerifyService],
})
export class AuditModule {}
