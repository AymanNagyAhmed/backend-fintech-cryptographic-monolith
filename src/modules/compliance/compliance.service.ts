import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditAccessService } from '../audit/audit-access.service.js';

export interface ComplianceSearchQuery {
  partitionKey?: string;
  type?: string;
  subjectRef?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ComplianceSearchHit {
  id: string;
  partitionKey: string;
  seq: string;
  type: string | null;
  occurredAt: string;
  hash: string;
}

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AuditAccessService,
  ) {}

  async search(
    actorId: string,
    query: ComplianceSearchQuery,
  ): Promise<{ hits: ComplianceSearchHit[]; count: number }> {
    const limit = Math.min(query.limit ?? 50, 200);
    const where: Prisma.AuditEventWhereInput = {};
    if (query.partitionKey) where.partitionKey = query.partitionKey;
    if (query.from || query.to) {
      where.occurredAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lt: new Date(query.to) } : {}),
      };
    }
    if (query.type) {
      where.payload = {
        path: ['type'],
        equals: query.type,
      };
    }
    if (query.subjectRef) {
      where.payload = {
        path: ['actor', 'subjectRef'],
        equals: query.subjectRef,
      };
    }

    const rows = await this.prisma.auditEvent.findMany({
      where,
      orderBy: [{ occurredAt: 'desc' }, { seq: 'desc' }],
      take: limit,
      select: {
        id: true,
        partitionKey: true,
        seq: true,
        occurredAt: true,
        hash: true,
        payload: true,
      },
    });

    const hits = rows.map((r) => {
      const payload = r.payload as { type?: string };
      return {
        id: r.id,
        partitionKey: r.partitionKey,
        seq: r.seq.toString(),
        type: typeof payload?.type === 'string' ? payload.type : null,
        occurredAt: r.occurredAt.toISOString(),
        hash: r.hash,
      };
    });

    await this.access.record(
      actorId,
      'search',
      [
        query.partitionKey && `partition=${query.partitionKey}`,
        query.type && `type=${query.type}`,
        query.subjectRef && `subject=${query.subjectRef}`,
        query.from && `from=${query.from}`,
        query.to && `to=${query.to}`,
      ]
        .filter(Boolean)
        .join('&') || 'all',
    );

    return { hits, count: hits.length };
  }
}
