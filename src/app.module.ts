import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { IdempotencyJobsModule } from './common/idempotency/jobs/idempotency-jobs.module.js';
import { ResponseInterceptor } from './common/interceptors/response.interceptor.js';
import { createValidationPipe } from './common/pipes/validation.pipe.js';
import { QueueModule } from './common/queue/queue.module.js';
import { RateLimitModule } from './common/throttler/rate-limit.module.js';
import {
  validate,
  type EnvironmentVariables,
} from './config/env.validation.js';
import { loggerParams } from './config/logger.config.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { B2bModule } from './modules/b2b/b2b.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { LedgerJobsModule } from './modules/ledger/jobs/ledger-jobs.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { TransfersModule } from './modules/transfers/transfers.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuditJobsModule } from './modules/audit/jobs/audit-jobs.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        loggerParams(config.get('NODE_ENV', { infer: true })),
    }),
    DatabaseModule,
    QueueModule,
    RateLimitModule,
    HealthModule,
    UsersModule,
    AuthModule,
    B2bModule,
    WalletsModule,
    LedgerModule,
    LedgerJobsModule,
    OutboxModule,
    TransfersModule,
    PaymentsModule,
    CryptoModule,
    AuditModule,
    AuditJobsModule,
    IdempotencyJobsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
