import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuditModule } from '../src/modules/audit/audit.module.js';
import { GENESIS_PREV_HASH, chainHash } from '../src/modules/audit/chain-hash.js';
import { ChainerService } from '../src/modules/audit/chainer.service.js';
import { OutboxModule } from '../src/modules/outbox/outbox.module.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';

// Needs Compose PostgreSQL (`make up`). Leaves chained rows (app_writer cannot DELETE).
describe('ChainerService (database)', () => {
  let prisma: PrismaService;
  let chainer: ChainerService;
  let outbox: OutboxService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        OutboxModule,
        AuditModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
    chainer = moduleRef.get(ChainerService);
    outbox = moduleRef.get(OutboxService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('drains a ledger outbox row into audit_events with a correct hash chain', async () => {
    const partitionKey = `e2e-${randomUUID().slice(0, 8)}`;
    const payload = {
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      actor: { subjectRef: randomUUID() },
      transferId: randomUUID(),
      sourceWalletId: randomUUID(),
      destinationWalletId: randomUUID(),
      currency: 'AED' as const,
      amount: '1.00',
      partitionKey,
    };
    const sourceId = await prisma.withTx((tx) =>
      outbox.enqueue(tx, 'ledger', payload),
    );

    // Drain backlog from earlier e2e runs, then our row
    let leaf = null;
    for (let i = 0; i < 40 && !leaf; i++) {
      await chainer.run();
      leaf = await prisma.auditEvent.findUnique({
        where: {
          sourceContext_sourceId: { sourceContext: 'ledger', sourceId },
        },
      });
    }
    expect(leaf).not.toBeNull();
    if (!leaf) throw new Error('unreachable');
    expect(leaf.partitionKey).toBe(partitionKey);
    expect(leaf.seq).toBe(1n);
    expect(leaf.prevHash).toBe(GENESIS_PREV_HASH);
    expect(leaf.hash).toBe(chainHash(GENESIS_PREV_HASH, leaf.payload));
    const marked = await prisma.ledgerOutbox.findUniqueOrThrow({
      where: { id: sourceId },
    });
    expect(marked.processedAt).not.toBeNull();

    // Idempotent on source: re-running does not add another leaf for this outbox id
    await chainer.run();
    expect(await prisma.auditEvent.count({ where: { partitionKey } })).toBe(1);
  });
});

