import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  auditLeafDigest,
  inclusionProof,
  merkleHashToHex,
  merkleRoot,
  verifyInclusion,
} from './merkle.js';

export interface InclusionProofResult {
  eventId: string;
  leafIndex: number;
  treeSize: number;
  rootHash: string;
  leafHash: string;
  path: string[];
  /** True when path recomputes to the published STH root. */
  verified: boolean;
}

@Injectable()
export class ProofsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inclusion proof of an audit event against the latest STH that covers it (A-B10.3).
   */
  async inclusionProofForEvent(eventId: string): Promise<InclusionProofResult> {
    const event = await this.prisma.auditEvent.findUnique({
      where: { id: eventId },
      select: { id: true, hash: true, createdAt: true },
    });
    if (!event) throw new NotFoundException(`audit event ${eventId} not found`);

    const sth = await this.prisma.treeHead.findFirst({
      orderBy: { treeSize: 'desc' },
    });
    if (!sth)
      throw new NotFoundException('no signed tree head published yet');

    const leaves = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: sth.treeSize,
      select: { id: true, hash: true },
    });
    const leafIndex = leaves.findIndex((l) => l.id === eventId);
    if (leafIndex < 0) {
      throw new NotFoundException(
        `event ${eventId} is not covered by latest STH (treeSize=${sth.treeSize})`,
      );
    }

    const digests = leaves.map((l) => auditLeafDigest(l.hash));
    const leafHash = digests[leafIndex]!;
    const pathBuf = inclusionProof(digests, leafIndex);
    const root = merkleRoot(digests, true);
    const verified =
      merkleHashToHex(root) === sth.rootHash &&
      verifyInclusion(
        leafHash,
        leafIndex,
        sth.treeSize,
        pathBuf,
        Buffer.from(sth.rootHash, 'hex'),
      );

    return {
      eventId,
      leafIndex,
      treeSize: sth.treeSize,
      rootHash: sth.rootHash,
      leafHash: merkleHashToHex(leafHash),
      path: pathBuf.map(merkleHashToHex),
      verified,
    };
  }
}
