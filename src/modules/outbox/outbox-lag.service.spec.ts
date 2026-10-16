import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { PrismaService } from '../../database/prisma.service.js';
import { OutboxLagService } from './outbox-lag.service.js';

describe('OutboxLagService', () => {
  it('warns when lag reaches the threshold and stays quiet below it', async () => {
    const queryRawTyped = vi
      .fn()
      .mockResolvedValueOnce([{ lag: 5 }])
      .mockResolvedValueOnce([{ lag: 10 }]);
    const service = new OutboxLagService(
      { $queryRawTyped: queryRawTyped } as unknown as PrismaService,
      { get: () => 10 } as unknown as ConfigService<EnvironmentVariables, true>,
    );
    const loggerWarn = vi.fn();
    (service as unknown as { logger: { warn: typeof loggerWarn } }).logger = {
      warn: loggerWarn,
    };

    await expect(service.checkAndAlert()).resolves.toBe(5);
    expect(loggerWarn).not.toHaveBeenCalled();
    await expect(service.checkAndAlert()).resolves.toBe(10);
    expect(loggerWarn).toHaveBeenCalledWith(
      { lag: 10, threshold: 10 },
      'Outbox lag above alert threshold',
    );
  });
});
