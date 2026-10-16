import type { Prisma } from '../../generated/prisma/client.js';
import type { OutboxEvent } from '../outbox/interfaces/outbox-event.interface.js';
import { OUTBOX_DEFER } from '../outbox/interfaces/outbox-handler-result.interface.js';
import { AuditOutboxHandler } from './audit-outbox.handler.js';
import type { ChainerService } from './chainer.service.js';

describe('AuditOutboxHandler', () => {
  const event: OutboxEvent = {
    context: 'ledger',
    id: 'out-1',
    type: 'transfer.completed',
    payload: { type: 'transfer.completed' },
    createdAt: new Date('2026-10-16T18:00:00.000Z'),
    tx: {} as Prisma.TransactionClient,
  };

  it('chains the row in the dispatcher transaction', async () => {
    const chainRow = vi.fn().mockResolvedValue('chained');
    const handler = new AuditOutboxHandler({
      chainRow,
    } as unknown as ChainerService);
    await expect(handler.handle(event)).resolves.toBeUndefined();
    expect(chainRow).toHaveBeenCalledWith(event.tx, {
      context: 'ledger',
      id: 'out-1',
      payload: event.payload,
      createdAt: event.createdAt,
    });
  });

  it('defers the row when the partition lock is held', async () => {
    const handler = new AuditOutboxHandler({
      chainRow: vi.fn().mockResolvedValue('skipped'),
    } as unknown as ChainerService);
    await expect(handler.handle(event)).resolves.toBe(OUTBOX_DEFER);
  });
});
