import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { OpenBaoHealthIndicator } from './indicators/openbao.health.js';
import { RedisHealthIndicator } from './indicators/redis.health.js';

// PrismaService comes from the global DatabaseModule
@Module({
  imports: [TerminusModule.forRoot({ errorLogStyle: 'json' })],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, OpenBaoHealthIndicator],
})
export class HealthModule {}
