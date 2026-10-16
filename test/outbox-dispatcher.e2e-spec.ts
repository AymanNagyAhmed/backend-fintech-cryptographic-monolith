import { ConfigModule } from '@nestjs/config';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Injectable } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AuditModule } from '../src/modules/audit/audit.module.js';
import type { OutboxEvent } from '../src/modules/outbox/interfaces/outbox-event.interface.js';
import { OUTBOX_DEFER } from '../src/modules/outbox/interfaces/outbox-handler-result.interface.js';
import { OutboxDispatcherService } from '../src/modules/outbox/outbox-dispatcher.service.js';
import { OutboxModule } from '../src/modules/outbox/outbox.module.js';
import { OutboxService } from '../src/modules/outbox/outbox.service.js';

// Needs Compose PostgreSQL (`make up`) with claim_outbox_batch. Leaves processed outbox rows
// and audit leaves (app_writer cannot DELETE), like the chainer e2e.
const delivered: string[] = [];

@Injectable()
class RecordingHandler {
  @OnEvent('outbox.transfer.completed', { suppressErrors: false })
  record(event: OutboxEvent): void {
    delivered.push(event.id);
  }
}

describe('OutboxDispatcherService (database)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let dispatcher: OutboxDispatcherService;

  const payload = () => ({
    type: 'transfer.completed',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    actor: { subjectRef: randomUUID() },
    transferId: randomUUID(),
    sourceWalletId: randomUUID(),
    destinationWalletId: randomUUID(),
    currency: 'AED' as const,
    amount: '1.00',
    partitionKey: `e2e-${randomUUID().slice(0, 8)}`,
  });

  const enqueue = (count: number) =>
    prisma.withTx(async (tx) => {
      const ids: string[] = [];
      for (let i = 0; i < count; i++)
        ids.push(await outbox.enqueue(tx, 'wallet', payload()));
      return ids;
    });

  const state = async (ids: string[]) => ({
    unprocessed: await prisma.walletOutbox.count({
      where: { id: { in: ids }, processedAt: null },
    }),
    leaves: await prisma.auditEvent.findMany({
      where: { sourceContext: 'wallet', sourceId: { in: ids } },
      select: { sourceId: true },
    }),
  });

  // Backlog from earlier runs is drained first (oldest first), then our rows.
  const dispatchUntilProcessed = async (ids: string[]) => {
    for (let i = 0; i < 30; i++) {
      await dispatcher.dispatch('wallet', 1000);
      if ((await state(ids)).unprocessed === 0) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('outbox rows were not processed');
  };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
        OutboxModule,
        AuditModule,
      ],
      providers: [RecordingHandler],
    }).compile();
    await moduleRef.init(); // registers the @OnEvent handlers
    prisma = moduleRef.get(PrismaService);
    outbox = moduleRef.get(OutboxService);
    dispatcher = moduleRef.get(OutboxDispatcherService);
  });

  beforeEach(() => {
    delivered.length = 0;
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('delivers each row to its handlers and the audit leaf in one transaction, once', async () => {
    const ids = await enqueue(3);
    await dispatchUntilProcessed(ids);

    const { unprocessed, leaves } = await state(ids);
    expect(unprocessed).toBe(0);
    expect(leaves.map((l) => l.sourceId).sort()).toEqual([...ids].sort());
    for (const id of ids)
      expect(delivered.filter((d) => d === id)).toHaveLength(1);

    // Nothing left to claim: a second run delivers none of our rows again
    delivered.length = 0;
    await dispatcher.dispatch('wallet', 1000);
    for (const id of ids) expect(delivered).not.toContain(id);
    expect((await state(ids)).leaves).toHaveLength(3);
  });

  it('claims disjoint batches for concurrent dispatchers (FOR UPDATE SKIP LOCKED)', async () => {
    const ids = await enqueue(4);
    const seen: string[] = [];
    const emitter = moduleRef.get(EventEmitter2);
    const slow = async (event: OutboxEvent) => {
      if (ids.includes(event.id)) seen.push(event.id);
      await new Promise((r) => setTimeout(r, 150));
    };
    emitter.on('outbox.**', slow);
    try {
      await Promise.all([
        dispatcher.dispatch('wallet', 1000),
        dispatcher.dispatch('wallet', 1000),
      ]);
      await dispatchUntilProcessed(ids);
    } finally {
      emitter.off('outbox.**', slow);
    }
    // each of our rows reached the handlers exactly once across both dispatchers
    expect([...seen].sort()).toEqual([...ids].sort());
    expect((await state(ids)).leaves).toHaveLength(4);
  }, 60_000);

  it('rolls back the whole batch when a handler throws, then delivers on the next run', async () => {
    const ids = await enqueue(2);
    const emitter = moduleRef.get(EventEmitter2);
    const failing = (event: OutboxEvent) => {
      if (event.id === ids[1]) throw new Error('handler failed');
    };
    emitter.on('outbox.**', failing, { prepend: true });
    try {
      await expect(dispatcher.dispatch('wallet', 1000)).rejects.toThrow(
        'handler failed',
      );
    } finally {
      emitter.off('outbox.**', failing);
    }
    const afterFailure = await state(ids);
    expect(afterFailure.unprocessed).toBe(2);
    expect(afterFailure.leaves).toHaveLength(0);

    await dispatchUntilProcessed(ids);
    expect((await state(ids)).leaves).toHaveLength(2);
  }, 60_000);

  it('leaves a deferred row unprocessed', async () => {
    const [id] = await enqueue(1);
    const emitter = moduleRef.get(EventEmitter2);
    const defer = (event: OutboxEvent) =>
      event.id === id ? OUTBOX_DEFER : undefined;
    emitter.on('outbox.**', defer);
    try {
      await dispatcher.dispatch('wallet', 1000);
      expect((await state([id])).unprocessed).toBe(1);
    } finally {
      emitter.off('outbox.**', defer);
    }
    await dispatchUntilProcessed([id]);
    expect((await state([id])).leaves).toHaveLength(1);
  }, 60_000);

  it('kill mid-dispatch (SIGKILL), restart: each event is delivered and chained once', async () => {
    const ids = await enqueue(3);

    const child = spawn(
      process.execPath,
      [
        '--import',
        'tsx',
        'test/fixtures/outbox-dispatch-victim.ts',
        ids.join(','),
      ],
      { env: process.env, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    const hanging = new Promise<void>((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        if (out.includes('HANGING')) resolve();
      });
      child.once('exit', () => reject(new Error(`child exited early: ${out}`)));
    });
    await hanging;
    child.removeAllListeners('exit');
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));

    // The killed transaction never committed: nothing processed, no leaf
    // (PostgreSQL may need a moment to notice the closed connection and release the locks)
    const afterKill = await state(ids);
    expect(afterKill.unprocessed).toBe(3);
    expect(afterKill.leaves).toHaveLength(0);

    delivered.length = 0;
    await dispatchUntilProcessed(ids);

    const { unprocessed, leaves } = await state(ids);
    expect(unprocessed).toBe(0);
    expect(leaves.map((l) => l.sourceId).sort()).toEqual([...ids].sort());
    for (const id of ids)
      expect(delivered.filter((d) => d === id)).toHaveLength(1);

    // And a further run does not deliver or chain them again
    delivered.length = 0;
    await dispatcher.dispatch('wallet', 1000);
    for (const id of ids) expect(delivered).not.toContain(id);
    expect((await state(ids)).leaves).toHaveLength(3);
  }, 120_000);
});
