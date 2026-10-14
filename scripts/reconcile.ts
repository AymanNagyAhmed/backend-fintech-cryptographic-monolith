// Runs one ledger reconciliation now, without the queue, as app_writer from .env:
//   npm run job:reconcile
// Prints the report as JSON; exit code 1 when anything does not reconcile.
import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import {
  validate,
  type EnvironmentVariables,
} from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ReconciliationService } from '../src/modules/ledger/reconciliation.service.js';

process.loadEnvFile(new URL('../.env', import.meta.url));
const env = validate(process.env);
const config = {
  get: (key: keyof EnvironmentVariables) => env[key],
} as unknown as ConfigService<EnvironmentVariables, true>;
const prisma = new PrismaService(config);

try {
  const report = await new ReconciliationService(prisma).run();
  console.log(JSON.stringify(report, null, 2));
  console.error(
    report.ok
      ? 'Reconciliation passed: 0 mismatches'
      : `Reconciliation FAILED: ${report.balanceMismatches.total} balance mismatches, ${report.unbalancedPostings.total} unbalanced postings`,
  );
  process.exitCode = report.ok ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
