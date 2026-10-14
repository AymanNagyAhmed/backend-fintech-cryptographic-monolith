import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import {
  IDEMPOTENCY_PURGE_JOB,
  IDEMPOTENCY_PURGE_JOB_OPTIONS,
  IDEMPOTENCY_PURGE_SCHEDULER_ID,
} from './idempotency-purge.constants.js';
import { IdempotencyPurgeScheduler } from './idempotency-purge.scheduler.js';

describe('IdempotencyPurgeScheduler', () => {
  const config = {
    get: () => '30 1 * * *',
  } as unknown as ConfigService<EnvironmentVariables, true>;

  afterEach(() => vi.restoreAllMocks());

  it('upserts one scheduler with the cron pattern in UTC', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const queue = { upsertJobScheduler: vi.fn().mockResolvedValue({}) };
    await new IdempotencyPurgeScheduler(
      queue as unknown as Queue,
      config,
    ).schedule();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      IDEMPOTENCY_PURGE_SCHEDULER_ID,
      { pattern: '30 1 * * *', tz: 'UTC' },
      { name: IDEMPOTENCY_PURGE_JOB, opts: IDEMPOTENCY_PURGE_JOB_OPTIONS },
    );
  });

  it('does not block or crash startup when Redis is unavailable', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const queue = {
      upsertJobScheduler: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const scheduler = new IdempotencyPurgeScheduler(
      queue as unknown as Queue,
      config,
    );
    expect(scheduler.onApplicationBootstrap()).toBeUndefined();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Could not schedule idempotency key purge',
      ),
    );
  });
});
