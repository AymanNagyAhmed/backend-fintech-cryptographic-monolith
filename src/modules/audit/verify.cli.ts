/**
 * CLI: npm run audit:verify [-- --partition=1]
 * Needs DATABASE_URL (app_writer). Exit 0 when ok, 1 when broken/gaps/duplicates.
 * Instantiates Prisma like scripts/reconcile.ts (no Nest DI) so env overrides work
 * for restore_test smoke (A-B16.6).
 */
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import {
  validate,
  type EnvironmentVariables,
} from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { VerifyService } from './verify.service.js';

process.loadEnvFile(new URL('../../../.env', import.meta.url));
const env = validate(process.env);
const config = {
  get: (key: keyof EnvironmentVariables) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;

async function main(): Promise<void> {
  const partitionArg = process.argv.find((a) => a.startsWith('--partition='));
  const partition = partitionArg?.slice('--partition='.length);
  const prisma = new PrismaService(config);
  try {
    const report = await new VerifyService(prisma).verify(
      partition || undefined,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
