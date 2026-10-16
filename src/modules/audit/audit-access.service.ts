import { Injectable } from '@nestjs/common';
import { getRequestId } from '../../common/request-context.js';
import { PrismaService } from '../../database/prisma.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export type AuditAccessOperation =
  | 'verify'
  | 'proof'
  | 'consistency'
  | 'search'
  | 'export';

/**
 * Records that someone read audit data (A-B9.8 / 2.1). Written to auth.outbox
 * in its own short transaction so a failed access log never rolls back the read.
 */
@Injectable()
export class AuditAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async record(
    subjectRef: string,
    operation: AuditAccessOperation,
    scope?: string,
  ): Promise<string> {
    const requestId = getRequestId();
    return this.prisma.withTx((tx) =>
      this.outbox.enqueue(tx, 'auth', {
        type: 'audit.access',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        actor: { subjectRef },
        ...(requestId !== undefined ? { requestId } : {}),
        operation,
        ...(scope !== undefined ? { scope } : {}),
      }),
    );
  }
}
