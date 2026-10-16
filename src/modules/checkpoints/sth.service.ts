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
    if (!row)
      throw new NotFoundException(`no STH for treeSize=${treeSize}`);
    return toDto(row);
  }
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
    hasTsaToken: row.tsaToken != null && row.tsaToken.length > 0,
  };
}
