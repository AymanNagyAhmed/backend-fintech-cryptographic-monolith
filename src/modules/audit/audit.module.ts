import { Module } from '@nestjs/common';

// Owns audit.audit_events (and later chainer / verify). Writers: chainer only (A-B9.5).
@Module({})
export class AuditModule {}
