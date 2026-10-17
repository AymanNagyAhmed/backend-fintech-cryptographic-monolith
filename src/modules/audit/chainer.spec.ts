import { ConfigService } from '@nestjs/config';
import type { ClockQualityService } from '../../common/clock/clock-quality.service.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import { GENESIS_PREV_HASH, chainHash } from './chain-hash.js';
import { ChainerService } from './chainer.service.js';

describe('ChainerService', () => {
  const payload = {
    type: 'transfer.completed',
    schemaVersion: 1,
    occurredAt: '2026-10-16T18:00:00.000Z',
    actor: { subjectRef: 'u1' },
    transferId: '11111111-1111-4111-8111-111111111111',
    sourceWalletId: '22222222-2222-4222-8222-222222222222',
    destinationWalletId: '33333333-3333-4333-8333-333333333333',
    currency: 'AED',
    amount: '10.50',
    partitionKey: '1',
  };

  const clockOk = {
    sample: vi.fn().mockResolvedValue({
      offsetSeconds: 0,
      quality: 'ok',
      outOfTolerance: false,
      source: 'stub',
    }),
  } as unknown as ClockQualityService;

  it('chains one outbox row onto an empty partition and marks it processed', async () => {
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    const findUnique = vi.fn().mockResolvedValue(null);
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({});
    const queryRawTyped = vi
      .fn()
      .mockResolvedValueOnce([
        {
          context: 'ledger',
          id: 'out-1',
          payload,
          createdAt: new Date(payload.occurredAt),
        },
      ])
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]); // second processOne: empty

    const tx = {
      $queryRawTyped: queryRawTyped,
      auditEvent: { findUnique, findFirst, create },
    };
    const withTx = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));

    const service = new ChainerService(
      { withTx } as unknown as PrismaService,
      { markProcessed } as unknown as OutboxService,
      clockOk,
      {
        get: () => 2,
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );

    const result = await service.run();
    expect(result).toEqual({ chained: 1, skippedLock: 0, empty: false });
    expect(create).toHaveBeenCalledWith({
      data: {
        partitionKey: '1',
        seq: 1n,
        payload,
        prevHash: GENESIS_PREV_HASH,
        hash: chainHash(GENESIS_PREV_HASH, payload),
        sourceContext: 'ledger',
        sourceId: 'out-1',
        occurredAt: new Date(payload.occurredAt),
      },
    });
    expect(markProcessed).toHaveBeenCalledWith(tx, 'ledger', 'out-1');
  });

  it('stamps clockQuality=degraded on the leaf when the host clock is out of tolerance', async () => {
    const markProcessed = vi.fn().mockResolvedValue(undefined);
    const create = vi.fn().mockResolvedValue({});
    const queryRawTyped = vi
      .fn()
      .mockResolvedValueOnce([
        {
          context: 'ledger',
          id: 'out-1',
          payload,
          createdAt: new Date(payload.occurredAt),
        },
      ])
      .mockResolvedValueOnce([{ locked: true }])
      .mockResolvedValueOnce([]);
    const tx = {
      $queryRawTyped: queryRawTyped,
      auditEvent: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create,
      },
    };
    const withTx = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    const clockDegraded = {
      sample: vi.fn().mockResolvedValue({
        offsetSeconds: 1.5,
        quality: 'degraded',
        outOfTolerance: true,
        source: 'chronyc',
      }),
    } as unknown as ClockQualityService;
    const service = new ChainerService(
      { withTx } as unknown as PrismaService,
      { markProcessed } as unknown as OutboxService,
      clockDegraded,
      { get: () => 2 } as unknown as ConfigService<EnvironmentVariables, true>,
    );
    await service.run();
    const leaf = { ...payload, clockQuality: 'degraded' };
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: leaf,
        hash: chainHash(GENESIS_PREV_HASH, leaf),
      }),
    });
  });

  it('skips when the partition advisory lock is held', async () => {
    const markProcessed = vi.fn();
    const queryRawTyped = vi
      .fn()
      .mockResolvedValueOnce([
        {
          context: 'ledger',
          id: 'out-1',
          payload,
          createdAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([{ locked: false }])
      .mockResolvedValueOnce([]);
    const tx = {
      $queryRawTyped: queryRawTyped,
      auditEvent: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
      },
    };
    const withTx = vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx));
    const service = new ChainerService(
      { withTx } as unknown as PrismaService,
      { markProcessed } as unknown as OutboxService,
      clockOk,
      { get: () => 2 } as unknown as ConfigService<EnvironmentVariables, true>,
    );
    await expect(service.run()).resolves.toEqual({
      chained: 0,
      skippedLock: 1,
      empty: false,
    });
    expect(markProcessed).not.toHaveBeenCalled();
  });
});
