import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  auditLeafDigest,
  merkleHashToHex,
  merkleRoot,
} from './merkle.js';

export interface CheckpointBuildResult {
  /** Number of audit leaves included in this tree. */
  treeSize: number;
  rootHash: string;
  /** First / last event id in seq order across all partitions (empty when treeSize=0). */
  fromEventId: string | null;
  toEventId: string | null;
  empty: boolean;
}

/**
 * Builds an RFC 6962 Merkle tree over chained audit leaves (A-B10.1).
 * Leaves are ordered by (created_at, id) globally so successive checkpoints
 * grow a single append-only tree. Persistence of the signed tree head is A-B10.2.
 */
@Injectable()
export class CheckpointerService {
  private readonly logger = new Logger(CheckpointerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build a Merkle root over the first `limit` audit events (or all if omitted).
   * Used by the worker and by later STH signing.
   */
  async build(limit?: number): Promise<CheckpointBuildResult> {
    const rows = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      ...(limit !== undefined ? { take: limit } : {}),
      select: { id: true, hash: true },
    });
    if (rows.length === 0) {
      return {
        treeSize: 0,
        rootHash: '',
        fromEventId: null,
        toEventId: null,
        empty: true,
      };
    }
    const digests = rows.map((r) => auditLeafDigest(r.hash));
    const root = merkleRoot(digests, true);
    const result: CheckpointBuildResult = {
      treeSize: rows.length,
      rootHash: merkleHashToHex(root),
      fromEventId: rows[0]!.id,
      toEventId: rows[rows.length - 1]!.id,
      empty: false,
    };
    this.logger.log(
      { treeSize: result.treeSize, rootHash: result.rootHash },
      'Merkle checkpoint built',
    );
    return result;
  }
}
