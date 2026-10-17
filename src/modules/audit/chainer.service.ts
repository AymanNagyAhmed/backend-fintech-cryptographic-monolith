import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClockQualityService } from '../../common/clock/clock-quality.service.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  claimOutboxRow,
  tryPartitionLock,
} from '../../generated/prisma/sql.js';
import type { OutboxContext } from '../outbox/outbox-context.js';
import type { OutboxRow } from '../outbox/outbox-row.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { GENESIS_PREV_HASH, chainHash } from './chain-hash.js';

export interface ChainerRunResult {
  chained: number;
  skippedLock: number;
  empty: boolean;
}

/**
 * Drains context outboxes into `audit.audit_events` off the request path (2.2, 2.4, 2.5).
 * Single writer per partition: `pg_try_advisory_xact_lock(hashtext(partition_key))`
 * (A-B9.6). Lock is transaction-scoped; on miss the outbox row is left unprocessed.
 */
@Injectable()
export class ChainerService {
  private readonly logger = new Logger(ChainerService.name);
  private readonly batchSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly clock: ClockQualityService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.batchSize = config.get('CHAINER_BATCH_SIZE', { infer: true });
  }

  /** Process up to CHAINER_BATCH_SIZE outbox rows (each in its own transaction). */
  async run(): Promise<ChainerRunResult> {
    let chained = 0;
    let skippedLock = 0;
    let empty = false;
    for (let i = 0; i < this.batchSize; i++) {
      const outcome = await this.prisma.withTx(
        (tx) => this.processOne(tx),
        undefined,
        { timeoutMs: 30_000 },
      );
      if (outcome === 'empty') {
        empty = i === 0;
        break;
      }
      if (outcome === 'skipped') skippedLock += 1;
      else chained += 1;
    }
    if (chained > 0 || skippedLock > 0)
      this.logger.log({ chained, skippedLock }, 'Chainer batch finished');
    return { chained, skippedLock, empty };
  }

  private async processOne(
    tx: Prisma.TransactionClient,
  ): Promise<'chained' | 'skipped' | 'empty'> {
    const [row] = await tx.$queryRawTyped(claimOutboxRow());
    if (!row?.context || !row.id || row.payload == null || !row.createdAt)
      return 'empty';
    const context = row.context as OutboxContext;
    const outcome = await this.chainRow(tx, {
      context,
      id: row.id,
      payload: row.payload,
      createdAt: row.createdAt,
    });
    if (outcome === 'chained')
      await this.outbox.markProcessed(tx, context, row.id);
    return outcome;
  }

  /**
   * Writes the audit leaf for one claimed outbox row in `tx` (shared by the chainer poll and
   * the outbox dispatcher handler); the caller marks the row processed, in the same `tx`.
   * Idempotent on (context, id). `skipped` = the partition lock is held by another writer;
   * nothing was written and the row must stay unprocessed.
   */
  async chainRow(
    tx: Prisma.TransactionClient,
    row: OutboxRow,
  ): Promise<'chained' | 'skipped'> {
    const { context, id: sourceId, createdAt } = row;

    const payload = row.payload as Record<string, unknown>;
    const partitionKey = partitionKeyOf(payload);
    const [{ locked }] = await tx.$queryRawTyped(
      tryPartitionLock(partitionKey),
    );
    if (!locked) return 'skipped';

    const existing = await tx.auditEvent.findFirst({
      where: { sourceContext: context, sourceId },
    });
    if (!existing) {
      const tip = await tx.auditEvent.findFirst({
        where: { partitionKey },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });
      const prevHash = tip?.hash ?? GENESIS_PREV_HASH;
      const seq = tip ? tip.seq + 1n : 1n;
      // Stamp clock quality before hashing so out-of-tolerance leaves are tamper-evident (2.9)
      const { quality } = await this.clock.sample();
      const leafPayload =
        quality === 'ok'
          ? payload
          : { ...payload, clockQuality: quality };
      const hash = chainHash(prevHash, leafPayload);
      const occurredAt = occurredAtOf(payload, createdAt);
      try {
        await tx.auditEvent.create({
          data: {
            partitionKey,
            seq,
            payload: leafPayload as Prisma.InputJsonValue,
            prevHash,
            hash,
            sourceContext: context,
            sourceId,
            occurredAt,
          },
        });
      } catch (e) {
        if (
          !(e instanceof Prisma.PrismaClientKnownRequestError) ||
          e.code !== 'P2002'
        )
          throw e;
      }
    }

    return 'chained';
  }
}

function partitionKeyOf(payload: Record<string, unknown>): string {
  const raw = payload.partitionKey;
  if (typeof raw === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(raw))
    return raw;
  return '0';
}

function occurredAtOf(payload: Record<string, unknown>, fallback: Date): Date {
  const raw = payload.occurredAt;
  if (typeof raw === 'string') {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}
