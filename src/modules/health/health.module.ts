import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { OpenBaoHealthIndicator } from './indicators/openbao.health.js';
import { PostgresHealthIndicator } from './indicators/postgres.health.js';
import { RedisHealthIndicator } from './indicators/redis.health.js';

@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' })],
  controllers: [HealthController],
  providers: [PostgresHealthIndicator, RedisHealthIndicator, OpenBaoHealthIndicator],
})
export class HealthModule {}
