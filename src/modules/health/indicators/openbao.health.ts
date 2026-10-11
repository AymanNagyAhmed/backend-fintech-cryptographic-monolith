import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { CHECK_CACHE_MS, CHECK_TIMEOUT_MS } from '../health.constants.js';

@Injectable()
export class OpenBaoHealthIndicator {
  private readonly url: string;

  constructor(
    private readonly indicator: HealthIndicatorService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.url = new URL('/v1/sys/health', config.get('BAO_ADDR', { infer: true })).toString();
  }

  check(key = 'openbao') {
    return this.indicator
      .check(key)
      .attempt(async ({ signal }) => {
        // 200 = initialized, unsealed and active; 429 standby, 501 not initialized, 503 sealed
        const res = await fetch(this.url, { signal });
        if (res.status !== 200) throw new Error(`OpenBao health returned ${res.status}`);
      })
      .withTimeout(CHECK_TIMEOUT_MS)
      .cacheFor(CHECK_CACHE_MS);
  }
}
