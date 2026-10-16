import {
  PutObjectCommand,
  S3Client,
  type ObjectLockMode,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';

export interface WormPutResult {
  key: string;
  etag?: string;
  skipped: boolean;
}

/**
 * WORM copy of each checkpoint batch: leaves + STH + TSA token (A-B10.7 / 2.1).
 * Uses S3 Object Lock compliance retention when the bucket supports it (LocalStack
 * WORM bucket once LOCALSTACK_AUTH_TOKEN is set).
 */
@Injectable()
export class WormService {
  private readonly logger = new Logger(WormService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly retentionDays = 30;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.bucket = config.get('WORM_BUCKET', { infer: true });
    this.client = new S3Client({
      region: config.get('AWS_REGION', { infer: true }),
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
        secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
      },
    });
  }

  /** Upload a JSON batch for the given treeSize; no-op if already present conceptually. */
  async putBatch(treeSize: number): Promise<WormPutResult> {
    const sth = await this.prisma.treeHead.findUnique({
      where: { treeSize },
    });
    if (!sth) throw new Error(`no STH for treeSize=${treeSize}`);

    const leaves = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: treeSize,
      select: {
        id: true,
        partitionKey: true,
        seq: true,
        hash: true,
        prevHash: true,
        occurredAt: true,
      },
    });

    const body = JSON.stringify({
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
      leaves,
    });

    const key = `checkpoints/treeSize=${treeSize}/batch.json`;
    const retainUntil = new Date(
      Date.now() + this.retentionDays * 24 * 60 * 60 * 1000,
    );
    try {
      const out = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          ObjectLockMode: 'COMPLIANCE' satisfies ObjectLockMode,
          ObjectLockRetainUntilDate: retainUntil,
        }),
      );
      this.logger.log({ key, etag: out.ETag }, 'WORM checkpoint batch stored');
      return { key, etag: out.ETag, skipped: false };
    } catch (err) {
      // LocalStack WORM bucket may be unavailable without auth token (A-B1)
      this.logger.warn(
        { err, key, bucket: this.bucket },
        'WORM put failed; checkpoint remains in DB',
      );
      throw err;
    }
  }
}
