import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { CHECK_CACHE_MS, CHECK_TIMEOUT_MS } from '../health.constants.js';

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly client: Redis;

  constructor(
    private readonly indicator: HealthIndicatorService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      // Fail fast while disconnected instead of queueing the PING
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: CHECK_TIMEOUT_MS,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
      connectionName: 'backend-health',
    });
    this.client.on('error', (err) => this.logger.debug({ err }, 'Redis health-check connection error'));
  }

  check(key = 'redis') {
    return this.indicator
      .check(key)
      .attempt(async () => {
        if (this.client.status === 'wait') await this.client.connect();
        const pong = await this.client.ping();
        if (pong !== 'PONG') throw new Error('Unexpected PING reply');
      })
      .withTimeout(CHECK_TIMEOUT_MS)
      .cacheFor(CHECK_CACHE_MS);
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
