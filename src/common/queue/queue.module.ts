import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { queueOptions } from '../../config/queue.config.js';

/** BullMQ on the Compose Redis (AOF on, so queued and scheduled jobs survive a restart). */
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        queueOptions(config.get('REDIS_URL', { infer: true })),
    }),
  ],
})
export class QueueModule {}
