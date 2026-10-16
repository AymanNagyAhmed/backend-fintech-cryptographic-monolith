import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaService } from '../../database/prisma.service.js';
import type { TreeHeadDto } from './dto/tree-head.dto.js';
import { SthService } from './sth.service.js';

/**
 * Hourly push of the latest STH to an external receipt log (A-B10.6).
 * Dev: append JSON lines under `var/sth-receipts/` (gitignored). Production
 * would POST to a third party and store HTTP receipts.
 */
@Injectable()
export class SthReceiptsService {
  private readonly logger = new Logger(SthReceiptsService.name);
  private readonly dir = join(process.cwd(), 'var', 'sth-receipts');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sth: SthService,
  ) {}

  async pushLatest(): Promise<{ pushed: boolean; treeSize?: number }> {
    let latest: TreeHeadDto;
    try {
      latest = await this.sth.latest();
    } catch {
      return { pushed: false };
    }
    await mkdir(this.dir, { recursive: true });
    const line = JSON.stringify({
      receivedAt: new Date().toISOString(),
      sth: latest,
      contentSha256: createHash('sha256')
        .update(
          JSON.stringify({
            treeSize: latest.treeSize,
            rootHash: latest.rootHash,
            timestamp: latest.timestamp,
          }),
        )
        .digest('hex'),
    });
    const file = join(this.dir, 'receipts.jsonl');
    await appendFile(file, `${line}\n`, 'utf8');
    // Also write a per-size snapshot for easy lookup
    await writeFile(
      join(this.dir, `sth-${latest.treeSize}.json`),
      `${JSON.stringify(latest, null, 2)}\n`,
      'utf8',
    );
    this.logger.log(
      { treeSize: latest.treeSize, file },
      'STH receipt pushed externally',
    );
    return { pushed: true, treeSize: latest.treeSize };
  }
}
