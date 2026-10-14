// Runs one purge of idempotency keys older than 30 days now, without the queue, as
// app_writer from .env:
//   npm run job:purge-idempotency-keys
// Prints the report as JSON.
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';
import { IdempotencyPurgeService } from '../src/common/idempotency/idempotency-purge.service.js';
import { PrismaService } from '../src/database/prisma.service.js';

process.loadEnvFile(new URL('../.env', import.meta.url));
const env = validate(process.env);
const config = {
  get: (key: keyof EnvironmentVariables) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;
const prisma = new PrismaService(config);

try {
  const report = await new IdempotencyPurgeService(prisma).purge();
  console.log(JSON.stringify(report, null, 2));
  console.error(
    `Idempotency key purge: ${report.deleted} keys older than ${report.retentionDays} days deleted` +
      (report.complete ? '' : ' (stopped at the batch cap, run again)'),
  );
} finally {
  await prisma.$disconnect();
}
