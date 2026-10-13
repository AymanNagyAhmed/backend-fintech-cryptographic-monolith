import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { requestSigningUnavailable } from './exceptions/signed-request.exceptions.js';

export const NONCE_KEY_PREFIX = 'nonce:';

/**
 * Remembers accepted nonces in Redis (AOF on, so they survive a Redis or app restart).
 * Keys are per client, so one client cannot burn another client's nonces.
 */
@Injectable()
export class NonceStore implements OnModuleDestroy {
  private readonly logger = new Logger(NonceStore.name);
  private readonly redis: Redis;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    this.redis = new Redis(config.get('REDIS_URL', { infer: true }), {
      connectionName: 'backend-nonces',
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    this.redis.on('error', (err) =>
      this.logger.warn({ err }, 'Redis nonce store connection error'),
    );
  }

  /** True the first time a nonce is seen for the client; atomic (SET NX). */
  async claim(
    clientId: string,
    nonce: string,
    ttlSec: number,
  ): Promise<boolean> {
    try {
      const res = await this.redis.set(
        `${NONCE_KEY_PREFIX}${clientId}:${nonce}`,
        '1',
        'EX',
        ttlSec,
        'NX',
      );
      return res === 'OK';
    } catch (err) {
      // Fail closed: without the store a replay cannot be detected
      this.logger.error({ err }, 'Nonce check failed');
      throw requestSigningUnavailable();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
