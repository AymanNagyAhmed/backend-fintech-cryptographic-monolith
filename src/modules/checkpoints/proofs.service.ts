import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import {
  auditLeafDigest,
  consistencyProof,
  inclusionProof,
  merkleHashToHex,
  merkleRoot,
  verifyInclusion,
} from '../../common/crypto/merkle.js';

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

export interface ConsistencyProofResult {
  from: number;
  to: number;
  fromRootHash: string;
  toRootHash: string;
  path: string[];
  /** True when both sizes match published STHs and recomputed roots agree. */
  verified: boolean;
}

@Injectable()
export class ProofsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inclusion proof of an audit event against the latest STH that covers it (A-B10.3).
   */
  async inclusionProofForEvent(eventId: string): Promise<InclusionProofResult> {
    const event = await this.prisma.auditEvent.findFirst({
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

  /**
   * Consistency proof between two published tree sizes (A-B10.4 / 2.3).
   * `from` and `to` are tree_size values of stored STHs (`from` < `to`).
   */
  async consistencyProofBetween(
    from: number,
    to: number,
  ): Promise<ConsistencyProofResult> {
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < 1)
      throw new BadRequestException('from and to must be positive integers');
    if (from > to)
      throw new BadRequestException('from must be <= to');

    const fromSth = await this.prisma.treeHead.findUnique({
      where: { treeSize: from },
    });
    const toSth = await this.prisma.treeHead.findUnique({
      where: { treeSize: to },
    });
    if (!fromSth || !toSth)
      throw new NotFoundException(
        `STH not found for treeSize from=${from} to=${to}`,
      );

    const leaves = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: to,
      select: { hash: true },
    });
    if (leaves.length < to)
      throw new NotFoundException(
        `only ${leaves.length} leaves available; need treeSize=${to}`,
      );

    const digests = leaves.map((l) => auditLeafDigest(l.hash));
    const fromRoot = merkleHashToHex(merkleRoot(digests.slice(0, from), true));
    const toRoot = merkleHashToHex(merkleRoot(digests, true));
    const path = consistencyProof(digests, from).map(merkleHashToHex);
    const verified =
      fromRoot === fromSth.rootHash && toRoot === toSth.rootHash;

    return {
      from,
      to,
      fromRootHash: fromSth.rootHash,
      toRootHash: toSth.rootHash,
      path,
      verified,
    };
  }
}
