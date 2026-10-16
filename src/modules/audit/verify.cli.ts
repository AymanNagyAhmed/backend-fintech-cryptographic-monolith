/**
 * CLI: npm run audit:verify [-- --partition=1]
 * Needs DATABASE_URL (app_writer). Exit 0 when ok, 1 when broken/gaps/duplicates.
 */
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { validate } from '../../config/env.validation.js';
import { DatabaseModule } from '../../database/database.module.js';
import { VerifyService } from './verify.service.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    DatabaseModule,
  ],
  providers: [VerifyService],
})
class VerifyCliModule {}

async function main(): Promise<void> {
  const partitionArg = process.argv.find((a) => a.startsWith('--partition='));
  const partition = partitionArg?.slice('--partition='.length);
  const app = await NestFactory.createApplicationContext(VerifyCliModule, {
    logger: false,
  });
  try {
    const report = await app.get(VerifyService).verify(partition || undefined);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await app.close();
  }
}

void main();
