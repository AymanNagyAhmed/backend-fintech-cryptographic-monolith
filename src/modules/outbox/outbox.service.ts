import { Injectable } from '@nestjs/common';
import { getRequestId } from '../../common/request-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { prepareAuditEvent } from '../../shared-kernel/audit/prepare-audit-event.js';
import type { OutboxContext } from './outbox-context.js';

type OutboxDelegate = {
  create: (args: {
    data: { payload: Prisma.InputJsonValue };
  }) => Promise<{ id: string }>;
  updateMany: (args: {
    where: { id: string; processedAt: null };
    data: { processedAt: Date };
  }) => Promise<{ count: number }>;
};

/**
 * Writes a prepared audit event into the calling context's outbox in the same
 * transaction as the business change (2.5). Claiming is done by the chainer.
 */
@Injectable()
export class OutboxService {
  /**
   * Redact + validate `payload`, then INSERT into `<context>.outbox`.
   * Returns the new row id (chainer idempotency key).
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

  /** Sets processed_at once after the audit leaf is written (or already existed). */
  async markProcessed(
    tx: Prisma.TransactionClient,
    context: OutboxContext,
    id: string,
  ): Promise<void> {
    await this.delegate(tx, context).updateMany({
      where: { id, processedAt: null },
      data: { processedAt: new Date() },
    });
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
      case 'withdrawals':
        return tx.withdrawalsOutbox;
    }
  }
}
