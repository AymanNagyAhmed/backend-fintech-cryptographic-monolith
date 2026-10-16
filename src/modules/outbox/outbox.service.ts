import { Injectable } from '@nestjs/common';
import { getRequestId } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prepareAuditEvent } from '../../shared-kernel/audit/prepare-audit-event.js';
import type { OutboxContext } from './outbox-context.js';

type OutboxDelegate = {
  create: (args: {
    data: { payload: Prisma.InputJsonValue };
  }) => Promise<{ id: string }>;
};

/**
 * Writes a prepared audit event into the calling context's outbox in the same
 * transaction as the business change (2.5). Claiming / chaining is A-B9.5+.
 */
@Injectable()
export class OutboxService {
  /**
   * Redact + validate `payload`, then INSERT into `<context>.outbox`.
   * Returns the new row id (chainer idempotency key later).
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    context: OutboxContext,
    payload: unknown,
  ): Promise<string> {
    const event = prepareAuditEvent(payload);
    const row = await this.delegate(tx, context).create({
      data: { payload: event as Prisma.InputJsonValue },
    });
    return row.id;
  }

  /** Prefer `getRequestId()` when building payloads inside a request. */
  requestId(): string | undefined {
    return getRequestId();
  }

  private delegate(
    tx: Prisma.TransactionClient,
    context: OutboxContext,
  ): OutboxDelegate {
    switch (context) {
      case 'auth':
        return tx.authOutbox;
      case 'wallet':
        return tx.walletOutbox;
      case 'ledger':
        return tx.ledgerOutbox;
      case 'payments':
        return tx.paymentsOutbox;
    }
  }
}
