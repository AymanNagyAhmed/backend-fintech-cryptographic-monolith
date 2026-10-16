import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { PrismaService } from '../../database/prisma.service.js';
import {
  OutboxEventTypeMissingError,
  OutboxNoHandlerError,
} from './exceptions/outbox-dispatch.exceptions.js';
import { OUTBOX_DEFER } from './interfaces/outbox-handler-result.interface.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import type { OutboxService } from './outbox.service.js';

describe('OutboxDispatcherService', () => {
  const createdAt = new Date('2026-10-16T18:00:00.000Z');
  const row = (id: string, type: string | null = 'transfer.completed') => ({
    id,
    payload: type ? { type } : {},
    createdAt,
  });

  type Handler = (event: unknown) => unknown;
  const ok: Handler = () => undefined;

  // `handlers` maps an event name to its listeners (what EventEmitter2.listeners returns)
  const setup = (rows: unknown[], handlers: Record<string, Handler[]>) => {
    const tx = { $queryRawTyped: vi.fn().mockResolvedValue(rows) };
    const listeners = vi.fn((name: string) => handlers[name] ?? []);
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    const service = new OutboxDispatcherService(
      {
        withTx: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      } as unknown as PrismaService,
      { listeners } as unknown as EventEmitter2,
      { markProcessed } as unknown as OutboxService,
    );
    return { service, tx, listeners, markProcessed };
  };

  it('claims one context, calls the outbox.<type> handlers with the tx and marks each row processed', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const other = vi.fn();
    const { service, tx, markProcessed } = setup(
      [row('a'), row('b', 'withdrawal.requested')],
      {
        'outbox.transfer.completed': [first, second],
        'outbox.withdrawal.requested': [other],
      },
    );

    await expect(service.dispatch('ledger', 10)).resolves.toEqual({
      context: 'ledger',
      delivered: 2,
      deferred: 0,
    });

    const eventA = expect.objectContaining({ context: 'ledger', id: 'a', tx });
    expect(first).toHaveBeenCalledWith(eventA);
    expect(second).toHaveBeenCalledWith(eventA);
    expect(other).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'b', type: 'withdrawal.requested' }),
    );
    expect(markProcessed).toHaveBeenCalledTimes(2);
    expect(markProcessed).toHaveBeenCalledWith(tx, 'ledger', 'a');
  });

  it('runs the handlers of one event one after another', async () => {
    const order: string[] = [];
    const slow: Handler = async () => {
      order.push('slow:start');
      await new Promise((r) => setTimeout(r, 10));
      order.push('slow:end');
    };
    const fast: Handler = () => {
      order.push('fast');
    };
    const { service } = setup([row('a')], {
      'outbox.transfer.completed': [slow, fast],
    });
    await service.dispatch('ledger');
    expect(order).toEqual(['slow:start', 'slow:end', 'fast']);
  });

  it('leaves a deferred row unprocessed and still delivers the others', async () => {
    const defer = vi
      .fn()
      .mockResolvedValueOnce(OUTBOX_DEFER)
      .mockResolvedValueOnce(undefined);
    const { service, markProcessed } = setup([row('a'), row('b')], {
      'outbox.transfer.completed': [defer],
    });
    await expect(service.dispatch('auth')).resolves.toMatchObject({
      delivered: 1,
      deferred: 1,
    });
    expect(markProcessed).toHaveBeenCalledTimes(1);
    expect(markProcessed).toHaveBeenCalledWith(expect.anything(), 'auth', 'b');
  });

  it('aborts the batch when nothing handles an event (the row must not be lost)', async () => {
    const { service, markProcessed } = setup([row('a')], {});
    await expect(service.dispatch('wallet')).rejects.toBeInstanceOf(
      OutboxNoHandlerError,
    );
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('aborts the batch when a handler throws, without running later handlers', async () => {
    const later = vi.fn();
    const { service, markProcessed } = setup([row('a')], {
      'outbox.transfer.completed': [
        () => {
          throw new Error('boom');
        },
        later,
      ],
    });
    await expect(service.dispatch('wallet')).rejects.toThrow('boom');
    expect(later).not.toHaveBeenCalled();
    expect(markProcessed).not.toHaveBeenCalled();
  });

  it('rejects a row without payload.type', async () => {
    const { service } = setup([row('a', null)], {});
    await expect(service.dispatch('payments')).rejects.toBeInstanceOf(
      OutboxEventTypeMissingError,
    );
  });

  it('returns zero counts for an empty outbox', async () => {
    const { service, listeners } = setup([], {});
    await expect(service.dispatch('ledger')).resolves.toEqual({
      context: 'ledger',
      delivered: 0,
      deferred: 0,
    });
    expect(listeners).not.toHaveBeenCalled();
  });

  it('dispatchAll runs every context once', async () => {
    const { service } = setup([], { 'outbox.x': [ok] });
    const results = await service.dispatchAll(5);
    expect(results.map((r) => r.context)).toEqual([
      'auth',
      'wallet',
      'ledger',
      'payments',
      'withdrawals',
    ]);
  });
});
