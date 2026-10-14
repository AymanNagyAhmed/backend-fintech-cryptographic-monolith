import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { IdempotencyPurgeService } from '../idempotency-purge.service.js';
import type { IdempotencyPurgeReport } from '../interfaces/idempotency-purge-report.interface.js';
import { IdempotencyPurgeProcessor } from './idempotency-purge.processor.js';

const report = (complete: boolean): IdempotencyPurgeReport => ({
  retentionDays: 30,
  deleted: complete ? 3 : 1_000_000,
  batches: complete ? 1 : 1000,
  complete,
  startedAt: '2026-10-14T01:30:00.000Z',
  finishedAt: '2026-10-14T01:30:01.000Z',
});

describe('IdempotencyPurgeProcessor', () => {
  const job = { id: '7' } as Job;
  let log: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  const processor = (r: IdempotencyPurgeReport | Error) =>
    new IdempotencyPurgeProcessor({
      purge:
        r instanceof Error
          ? vi.fn().mockRejectedValue(r)
          : vi.fn().mockResolvedValue(r),
    } as unknown as IdempotencyPurgeService);

  it('returns the report and logs a summary', async () => {
    const r = report(true);
    await expect(processor(r).process(job)).resolves.toBe(r);
    expect(log).toHaveBeenCalledWith(
      { jobId: '7', deleted: 3, batches: 1 },
      'Idempotency key purge finished',
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns but completes the job when the run stopped at the batch cap', async () => {
    const r = report(false);
    await expect(processor(r).process(job)).resolves.toBe(r);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ deleted: 1_000_000 }),
      expect.stringContaining('batch cap'),
    );
  });

  it('fails the job when the database is unreachable, so BullMQ retries it', async () => {
    await expect(
      processor(new Error('connection refused')).process(job),
    ).rejects.toThrow('connection refused');
  });
});
