import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { GENESIS_PREV_HASH, chainHash } from './chain-hash.js';
import type {
  BrokenAt,
  VerifyReport,
} from './interfaces/verify-report.interface.js';

/**
 * Offline-style chain verification over `audit.audit_events` (A-B9.9 / 2.1).
 * Walks each partition in seq order; reports the first broken hash and any gaps.
 */
@Injectable()
export class VerifyService {
  constructor(private readonly prisma: PrismaService) {}

  async verify(partitionKey?: string): Promise<VerifyReport> {
    const partitions = partitionKey
      ? [partitionKey]
      : (
          await this.prisma.auditEvent.findMany({
            distinct: ['partitionKey'],
            select: { partitionKey: true },
            orderBy: { partitionKey: 'asc' },
          })
        ).map((r) => r.partitionKey);

    let eventsChecked = 0;
    let brokenAt: BrokenAt | null = null;
    const gaps: BrokenAt[] = [];
    const duplicates: BrokenAt[] = [];

    for (const partition of partitions) {
      const rows = await this.prisma.auditEvent.findMany({
        where: { partitionKey: partition },
        orderBy: { seq: 'asc' },
        select: {
          seq: true,
          payload: true,
          prevHash: true,
          hash: true,
        },
      });

      let expectedSeq = 1n;
      let expectedPrev = GENESIS_PREV_HASH;
      const seen = new Set<string>();

      for (const row of rows) {
        eventsChecked += 1;
        const seqKey = row.seq.toString();
        if (seen.has(seqKey)) {
          duplicates.push({ partition, seq: seqKey });
          continue;
        }
        seen.add(seqKey);

        while (expectedSeq < row.seq) {
          gaps.push({ partition, seq: expectedSeq.toString() });
          expectedSeq += 1n;
        }

        const expectedHash = chainHash(expectedPrev, row.payload);
        if (
          brokenAt === null &&
          (row.prevHash !== expectedPrev || row.hash !== expectedHash)
        ) {
          brokenAt = { partition, seq: seqKey };
        }

        expectedPrev = row.hash;
        expectedSeq = row.seq + 1n;
      }
    }

    return {
      ok: brokenAt === null && gaps.length === 0 && duplicates.length === 0,
      partitionsChecked: partitions.length,
      eventsChecked,
      brokenAt,
      gaps,
      duplicates,
    };
  }
}
