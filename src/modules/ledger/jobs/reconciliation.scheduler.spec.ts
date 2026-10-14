import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import {
  RECONCILIATION_JOB,
  RECONCILIATION_JOB_OPTIONS,
  RECONCILIATION_SCHEDULER_ID,
} from './reconciliation.constants.js';
import { ReconciliationScheduler } from './reconciliation.scheduler.js';

describe('ReconciliationScheduler', () => {
  const config = {
    get: () => '0 1 * * *',
  } as unknown as ConfigService<EnvironmentVariables, true>;

  afterEach(() => vi.restoreAllMocks());

  it('upserts one scheduler with the cron pattern in UTC', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const queue = { upsertJobScheduler: vi.fn().mockResolvedValue({}) };
    await new ReconciliationScheduler(
      queue as unknown as Queue,
      config,
    ).schedule();
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      RECONCILIATION_SCHEDULER_ID,
      { pattern: '0 1 * * *', tz: 'UTC' },
      { name: RECONCILIATION_JOB, opts: RECONCILIATION_JOB_OPTIONS },
    );
  });

  it('does not block or crash startup when Redis is unavailable', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const queue = {
      upsertJobScheduler: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const scheduler = new ReconciliationScheduler(
      queue as unknown as Queue,
      config,
    );
    expect(scheduler.onApplicationBootstrap()).toBeUndefined();
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Could not schedule ledger reconciliation',
      ),
    );
  });
});
