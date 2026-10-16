import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { countOutboxLag } from '../../generated/prisma/sql.js';

/**
 * Observes outbox depth. Requests never await the chainer (2.5); this only alerts
 * when unprocessed rows exceed OUTBOX_LAG_ALERT_THRESHOLD (A-B9.7).
 */
@Injectable()
export class OutboxLagService {
  private readonly logger = new Logger(OutboxLagService.name);
  private readonly threshold: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.threshold = config.get('OUTBOX_LAG_ALERT_THRESHOLD', { infer: true });
  }

  async lag(): Promise<number> {
    const [{ lag }] = await this.prisma.$queryRawTyped(countOutboxLag());
    return lag ?? 0;
  }

  /** Log a warning when lag is at or above the alert threshold. Returns current lag. */
  async checkAndAlert(): Promise<number> {
    const lag = await this.lag();
    if (lag >= this.threshold)
      this.logger.warn(
        { lag, threshold: this.threshold },
        'Outbox lag above alert threshold',
      );
    return lag;
  }
}
