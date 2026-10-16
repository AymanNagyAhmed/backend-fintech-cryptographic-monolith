// Hash-chain verify for chaos (A-B15.4). Skips leftover tamper-suite partitions
// (vfy-*, tamper-*) that intentionally break the chain and cannot be DELETEd
// (audit_events is append-only).
//   node test/chaos/verify.mjs
import 'reflect-metadata';
import { validate } from '../../dist/config/env.validation.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { VerifyService } from '../../dist/modules/audit/verify.service.js';

const SKIP = /^(vfy-|tamper-)/;

process.loadEnvFile(new URL('../../.env', import.meta.url));
const env = validate(process.env);
const config = { get: (key) => env[key] };
const prisma = new PrismaService(config);
const verify = new VerifyService(prisma);

try {
  const keys = (
    await prisma.auditEvent.findMany({
      distinct: ['partitionKey'],
      select: { partitionKey: true },
      orderBy: { partitionKey: 'asc' },
    })
  )
    .map((r) => r.partitionKey)
    .filter((k) => !SKIP.test(k));

  let eventsChecked = 0;
  let brokenAt = null;
  const gaps = [];
  const duplicates = [];
  for (const key of keys) {
    const report = await verify.verify(key);
    eventsChecked += report.eventsChecked;
    if (!brokenAt && report.brokenAt) brokenAt = report.brokenAt;
    gaps.push(...report.gaps);
    duplicates.push(...report.duplicates);
  }
  const ok = brokenAt === null && gaps.length === 0 && duplicates.length === 0;
  const out = {
    ok,
    partitionsChecked: keys.length,
    eventsChecked,
    brokenAt,
    gaps,
    duplicates,
    skippedPrefix: SKIP.source,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = ok ? 0 : 1;
} finally {
  await prisma.$disconnect();
}
