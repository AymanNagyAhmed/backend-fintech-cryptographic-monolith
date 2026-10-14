import type { PrismaService } from '../../database/prisma.service.js';
import { IdempotencyPurgeService } from './idempotency-purge.service.js';

describe('IdempotencyPurgeService', () => {
  const prisma = { $queryRawTyped: vi.fn() };
  const service = new IdempotencyPurgeService(
    prisma as unknown as PrismaService,
  );
  const batches = (...counts: (number | null)[]) => {
    for (const deleted of counts)
      prisma.$queryRawTyped.mockResolvedValueOnce([{ deleted }]);
  };
  const args = (call: number) =>
    (prisma.$queryRawTyped.mock.calls[call][0] as { values: unknown[] }).values;

  beforeEach(() => {
    prisma.$queryRawTyped.mockReset();
  });

  it('calls the database function with 30 days and the batch size', async () => {
    batches(0);
    const report = await service.purge();
    expect(args(0)).toEqual([30, 1000]);
    expect(report).toMatchObject({
      retentionDays: 30,
      deleted: 0,
      batches: 1,
      complete: true,
    });
  });

  it('repeats full batches until one comes back short', async () => {
    batches(2, 2, 1);
    await expect(service.purge({ batchSize: 2 })).resolves.toMatchObject({
      deleted: 5,
      batches: 3,
      complete: true,
    });
  });

  it('stops at maxBatches and reports the run as incomplete', async () => {
    batches(2, 2, 2);
    await expect(
      service.purge({ batchSize: 2, maxBatches: 2 }),
    ).resolves.toMatchObject({ deleted: 4, batches: 2, complete: false });
    expect(prisma.$queryRawTyped).toHaveBeenCalledTimes(2);
  });

  it('treats a null count as 0', async () => {
    batches(null);
    await expect(service.purge()).resolves.toMatchObject({
      deleted: 0,
      complete: true,
    });
  });

  it('fails when the database fails, so the job retries', async () => {
    prisma.$queryRawTyped.mockRejectedValue(new Error('connection refused'));
    await expect(service.purge()).rejects.toThrow('connection refused');
  });
});
