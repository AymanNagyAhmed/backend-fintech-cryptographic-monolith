import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;

export interface PiiScanReport {
  scanned: number;
  hits: { id: string; partitionKey: string; seq: string }[];
  ok: boolean;
}

/**
 * Scans audit payloads for plaintext email-shaped PII (A-B11.5 / 2.8 Done-when).
 */
@Injectable()
export class PiiScannerService {
  private readonly logger = new Logger(PiiScannerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async scan(limit = 5000): Promise<PiiScanReport> {
    const rows = await this.prisma.auditEvent.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        partitionKey: true,
        seq: true,
        payload: true,
      },
    });
    const hits: PiiScanReport['hits'] = [];
    for (const row of rows) {
      const text = JSON.stringify(row.payload);
      if (EMAIL_RE.test(text)) {
        hits.push({
          id: row.id,
          partitionKey: row.partitionKey,
          seq: row.seq.toString(),
        });
      }
    }
    const report = { scanned: rows.length, hits, ok: hits.length === 0 };
    if (!report.ok)
      this.logger.error(
        { count: hits.length },
        'Plaintext PII found in audit payloads',
      );
    else this.logger.log({ scanned: report.scanned }, 'PII scan clean');
    return report;
  }
}
