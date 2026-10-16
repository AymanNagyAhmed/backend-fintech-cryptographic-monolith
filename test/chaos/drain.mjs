// Drain context outboxes into audit_events without BullMQ (A-B15.4 post-fault recovery).
// After Redis/Postgres kills the chainer worker may lag; this walks ChainerService.run()
// until every outbox is empty or MAX_ROUNDS is hit.
//   node test/chaos/drain.mjs
import 'reflect-metadata';
import { validate } from '../../dist/config/env.validation.js';
import { PrismaService } from '../../dist/database/prisma.service.js';
import { ChainerService } from '../../dist/modules/audit/chainer.service.js';
import { OutboxService } from '../../dist/modules/outbox/outbox.service.js';

process.loadEnvFile(new URL('../../.env', import.meta.url));
const env = validate(process.env);
const config = { get: (key) => env[key] };

const prisma = new PrismaService(config);
const outbox = new OutboxService();
const chainer = new ChainerService(prisma, outbox, config);

const MAX_ROUNDS = Number(process.env.CHAOS_DRAIN_ROUNDS ?? 500);

async function pendingCount() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM (
       SELECT 1 FROM auth.outbox WHERE processed_at IS NULL
       UNION ALL SELECT 1 FROM wallet.outbox WHERE processed_at IS NULL
       UNION ALL SELECT 1 FROM ledger.outbox WHERE processed_at IS NULL
       UNION ALL SELECT 1 FROM payments.outbox WHERE processed_at IS NULL
       UNION ALL SELECT 1 FROM withdrawals.outbox WHERE processed_at IS NULL
     ) t`,
  );
  return rows[0]?.n ?? 0;
}

try {
  let pending = await pendingCount();
  console.error(`drain: starting with ${pending} pending outbox rows`);
  for (let round = 0; round < MAX_ROUNDS && pending > 0; round++) {
    const result = await chainer.run();
    pending = await pendingCount();
    if (round % 10 === 0 || pending === 0 || result.empty) {
      console.error(
        `drain: round=${round} chained=${result.chained} skipped=${result.skippedLock} pending=${pending}`,
      );
    }
    if (result.empty && result.chained === 0 && result.skippedLock === 0) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  pending = await pendingCount();
  if (pending > 0) {
    console.error(`drain: FAILED with ${pending} rows still pending`);
    process.exitCode = 1;
  } else {
    console.error('drain: empty');
  }
} finally {
  await prisma.$disconnect();
}
