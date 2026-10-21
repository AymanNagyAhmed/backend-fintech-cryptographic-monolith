import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { TreeHeadDto } from './dto/tree-head.dto.js';

@Injectable()
export class SthService {
  constructor(private readonly prisma: PrismaService) {}

  async latest(): Promise<TreeHeadDto> {
    const row = await this.prisma.treeHead.findFirst({
      orderBy: { treeSize: 'desc' },
    });
    if (!row) throw new NotFoundException('no signed tree head published yet');
    return toDto(row);
  }

  async byTreeSize(treeSize: number): Promise<TreeHeadDto> {
    const row = await this.prisma.treeHead.findUnique({
      where: { treeSize },
    });
    if (!row) throw new NotFoundException(`no STH for treeSize=${treeSize}`);
    return toDto(row);
  }

  /**
   * Newest signed tree head whose RFC 3161 token is already stored.
   * A head written while the TSA is down is skipped.
   */
  async latestAnchored(): Promise<TreeHeadDto> {
    const rows = await this.prisma.treeHead.findMany({
      where: { tsaToken: { not: null } },
      orderBy: { treeSize: 'desc' },
    });
    const row = rows.find((candidate) => storedTsaToken(candidate.tsaToken));
    if (!row)
      throw new NotFoundException('no time-anchored tree head published yet');
    return toDto(row);
  }
}

export function storedTsaToken(token: Uint8Array | null | undefined): boolean {
  return token != null && token.length > 0;
}

function toDto(row: {
  id: string;
  treeSize: number;
  rootHash: string;
  timestamp: Date;
  previousSthHash: string | null;
  alg: string;
  keyId: string;
  signature: string;
  tsaToken: Uint8Array | null;
  clockQuality: string;
}): TreeHeadDto {
  return {
    id: row.id,
    treeSize: row.treeSize,
    rootHash: row.rootHash,
    timestamp: row.timestamp.toISOString(),
    previousSthHash: row.previousSthHash,
    alg: row.alg,
    keyId: row.keyId,
    signature: row.signature,
    hasTsaToken: storedTsaToken(row.tsaToken),
    timeAnchored: storedTsaToken(row.tsaToken),
    clockQuality: row.clockQuality as TreeHeadDto['clockQuality'],
  };
}
