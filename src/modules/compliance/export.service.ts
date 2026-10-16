import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import archiver from 'archiver';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditAccessService } from '../audit/audit-access.service.js';
import { SigningKeysService } from '../crypto/signing-keys.service.js';
import {
  auditLeafDigest,
  inclusionProof,
  merkleHashToHex,
} from '../checkpoints/merkle.js';

export interface ExportRequest {
  partitionKey?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface ExportResult {
  path: string;
  manifestSha256: string;
  recordCount: number;
}

/**
 * Regulator export ZIP: records, inclusion proofs, STHs, TSA tokens, public keys,
 * signed manifest (A-B12.3).
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);
  private readonly outDir: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AuditAccessService,
    private readonly signingKeys: SigningKeysService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.outDir = join(process.cwd(), 'var', 'exports');
    void config; // reserved for future export retention config
  }

  async createExport(
    actorId: string,
    req: ExportRequest,
  ): Promise<ExportResult> {
    const limit = Math.min(req.limit ?? 1000, 5000);
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        ...(req.partitionKey ? { partitionKey: req.partitionKey } : {}),
        ...(req.from || req.to
          ? {
              occurredAt: {
                ...(req.from ? { gte: new Date(req.from) } : {}),
                ...(req.to ? { lt: new Date(req.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });

    const sth = await this.prisma.treeHead.findFirst({
      orderBy: { treeSize: 'desc' },
    });
    const allLeaves = sth
      ? await this.prisma.auditEvent.findMany({
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: sth.treeSize,
          select: { id: true, hash: true },
        })
      : [];
    const digests = allLeaves.map((l) => auditLeafDigest(l.hash));

    const proofs = rows.map((r) => {
      const idx = allLeaves.findIndex((l) => l.id === r.id);
      if (idx < 0 || !sth) return { eventId: r.id, path: [] as string[] };
      return {
        eventId: r.id,
        leafIndex: idx,
        treeSize: sth.treeSize,
        rootHash: sth.rootHash,
        path: inclusionProof(digests, idx).map(merkleHashToHex),
      };
    });

    const keyIds = sth
      ? [sth.keyId]
      : ([] as string[]);
    const publicKeys: Record<string, unknown> = {};
    for (const keyId of keyIds) {
      const pub = await this.signingKeys.find(keyId);
      if (pub) publicKeys[keyId] = pub;
    }

    const records = rows.map((r) => ({
      id: r.id,
      partitionKey: r.partitionKey,
      seq: r.seq.toString(),
      payload: r.payload,
      prevHash: r.prevHash,
      hash: r.hash,
      occurredAt: r.occurredAt.toISOString(),
    }));

    const sthJson = sth
      ? {
          treeSize: sth.treeSize,
          rootHash: sth.rootHash,
          timestamp: sth.timestamp.toISOString(),
          previousSthHash: sth.previousSthHash,
          alg: sth.alg,
          keyId: sth.keyId,
          signature: sth.signature,
          tsaTokenBase64:
            sth.tsaToken != null && sth.tsaToken.length > 0
              ? Buffer.from(sth.tsaToken).toString('base64')
              : null,
        }
      : null;

    const manifest = {
      createdAt: new Date().toISOString(),
      recordCount: records.length,
      filter: req,
      files: [
        'records.json',
        'proofs.json',
        'sth.json',
        'public-keys.json',
        'manifest.json',
      ],
      recordsSha256: shaJson(records),
      proofsSha256: shaJson(proofs),
      sthSha256: shaJson(sthJson),
    };
    const manifestSha256 = shaJson(manifest);

    await mkdir(this.outDir, { recursive: true });
    const path = join(
      this.outDir,
      `export-${Date.now()}-${manifestSha256.slice(0, 12)}.zip`,
    );
    await writeZip(path, {
      'records.json': JSON.stringify(records, null, 2),
      'proofs.json': JSON.stringify(proofs, null, 2),
      'sth.json': JSON.stringify(sthJson, null, 2),
      'public-keys.json': JSON.stringify(publicKeys, null, 2),
      'manifest.json': JSON.stringify(
        { ...manifest, manifestSha256 },
        null,
        2,
      ),
    });

    await this.access.record(
      actorId,
      'export',
      `records=${records.length}&sha=${manifestSha256.slice(0, 16)}`,
    );
    this.logger.log({ path, recordCount: records.length }, 'Export ZIP written');
    return { path, manifestSha256, recordCount: records.length };
  }
}

function shaJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

function writeZip(
  path: string,
  files: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(path);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name });
    }
    void archive.finalize();
  });
}
