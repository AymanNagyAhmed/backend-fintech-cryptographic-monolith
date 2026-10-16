import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  auditLeafDigest,
  merkleHashToHex,
  merkleRoot,
} from './merkle.js';
import { sthContentHash, type SthPayload } from './sth-payload.js';

export interface WitnessReport {
  ok: boolean;
  checkedPairs: number;
  /** Fork: two STHs claim incompatible history. */
  forkAt?: { from: number; to: number; reason: string };
  /** Rollback: latest STH treeSize shrank vs previous run (stored as alert only). */
  rollback?: { previousMax: number; currentMax: number };
}

/**
 * Independent consistency checks between successive STHs (A-B10.8 / 2.3).
 * Alerts on fork (previousSthHash mismatch) or leaf-root mismatch.
 */
@Injectable()
export class WitnessService {
  private readonly logger = new Logger(WitnessService.name);
  private lastMaxTreeSize = 0;

  constructor(private readonly prisma: PrismaService) {}

  async check(): Promise<WitnessReport> {
    const heads = await this.prisma.treeHead.findMany({
      orderBy: { treeSize: 'asc' },
    });
    if (heads.length === 0) {
      return { ok: true, checkedPairs: 0 };
    }

    const currentMax = heads[heads.length - 1]!.treeSize;
    let rollback: WitnessReport['rollback'];
    if (this.lastMaxTreeSize > 0 && currentMax < this.lastMaxTreeSize) {
      rollback = {
        previousMax: this.lastMaxTreeSize,
        currentMax,
      };
      this.logger.error(rollback, 'STH treeSize rollback detected');
    }
    this.lastMaxTreeSize = currentMax;

    const leafCount = await this.prisma.auditEvent.count();
    if (leafCount < currentMax) {
      const report: WitnessReport = {
        ok: false,
        checkedPairs: 0,
        forkAt: {
          from: 0,
          to: currentMax,
          reason: `only ${leafCount} leaves for treeSize=${currentMax}`,
        },
        ...(rollback !== undefined ? { rollback } : {}),
      };
      this.logger.error(report.forkAt, 'STH leaf truncation detected');
      return report;
    }

    let checkedPairs = 0;
    for (let i = 1; i < heads.length; i++) {
      const prev = heads[i - 1]!;
      const cur = heads[i]!;
      checkedPairs += 1;
      const prevPayload: SthPayload = {
        treeSize: prev.treeSize,
        rootHash: prev.rootHash,
        timestamp: prev.timestamp.toISOString(),
        previousSthHash: prev.previousSthHash,
      };
      const expectedPrevHash = sthContentHash(prevPayload);
      if (cur.previousSthHash !== expectedPrevHash) {
        const report: WitnessReport = {
          ok: false,
          checkedPairs,
          forkAt: {
            from: prev.treeSize,
            to: cur.treeSize,
            reason: 'previousSthHash mismatch',
          },
          ...(rollback !== undefined ? { rollback } : {}),
        };
        this.logger.error(report.forkAt, 'STH fork detected');
        return report;
      }

      const leaves = await this.prisma.auditEvent.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: cur.treeSize,
        select: { hash: true },
      });
      if (leaves.length < cur.treeSize) {
        const report: WitnessReport = {
          ok: false,
          checkedPairs,
          forkAt: {
            from: prev.treeSize,
            to: cur.treeSize,
            reason: `only ${leaves.length} leaves for treeSize=${cur.treeSize}`,
          },
          ...(rollback !== undefined ? { rollback } : {}),
        };
        this.logger.error(report.forkAt, 'STH leaf truncation detected');
        return report;
      }
      const root = merkleHashToHex(
        merkleRoot(
          leaves.map((l) => auditLeafDigest(l.hash)),
          true,
        ),
      );
      if (root !== cur.rootHash) {
        const report: WitnessReport = {
          ok: false,
          checkedPairs,
          forkAt: {
            from: prev.treeSize,
            to: cur.treeSize,
            reason: 'recomputed root mismatch',
          },
          ...(rollback !== undefined ? { rollback } : {}),
        };
        this.logger.error(report.forkAt, 'STH root mismatch');
        return report;
      }
    }

    const report: WitnessReport = {
      ok: true,
      checkedPairs,
      ...(rollback !== undefined ? { rollback } : {}),
    };
    if (checkedPairs > 0)
      this.logger.log({ checkedPairs, currentMax }, 'Witness check ok');
    return report;
  }
}
