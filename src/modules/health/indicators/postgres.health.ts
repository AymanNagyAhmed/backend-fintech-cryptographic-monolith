import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Pool } from 'pg';
import type { EnvironmentVariables } from '../../../config/env.validation.js';
import { CHECK_CACHE_MS, CHECK_TIMEOUT_MS } from '../health.constants.js';

// Own one-connection pool until A-B3.4, then this check moves to PrismaHealthIndicator
@Injectable()
export class PostgresHealthIndicator implements OnModuleDestroy {
  private readonly logger = new Logger(PostgresHealthIndicator.name);
  private readonly pool: Pool;

  constructor(
    private readonly indicator: HealthIndicatorService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.pool = new Pool({
      connectionString: config.get('DATABASE_URL', { infer: true }),
      max: 1,
      connectionTimeoutMillis: CHECK_TIMEOUT_MS,
      idleTimeoutMillis: 10_000,
      statement_timeout: CHECK_TIMEOUT_MS,
      application_name: 'backend-health',
    });
    // An idle client dropped by a database restart must not crash the process
    this.pool.on('error', (err) => this.logger.warn({ err }, 'Idle health-check connection failed'));
  }

  check(key = 'database') {
    return this.indicator
      .check(key)
      .attempt(async () => {
        await this.pool.query('SELECT 1');
      })
      .withTimeout(CHECK_TIMEOUT_MS)
      .cacheFor(CHECK_CACHE_MS);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
