import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { throttlerOptions } from '../../config/throttler.config.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

/** Global rate limit on Redis; import before AuthModule so floods are cut before token checks. */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, Reflector],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
        reflector: Reflector,
      ) =>
        throttlerOptions(
          RedisThrottlerStorage.fromUrl(
            config.get('REDIS_URL', { infer: true }),
          ),
          reflector,
        ),
    }),
  ],
  providers: [
    ThrottlerGuard,
    // useExisting, so tests can replace the guard with overrideProvider(ThrottlerGuard)
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
  ],
})
export class RateLimitModule {}
