import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service.js';

// PrismaService comes from the global DatabaseModule
@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
