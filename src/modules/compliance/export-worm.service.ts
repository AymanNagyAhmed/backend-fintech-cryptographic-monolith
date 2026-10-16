import { readFile } from 'node:fs/promises';
import {
  PutObjectCommand,
  S3Client,
  type ObjectLockMode,
} from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';

/**
 * WORM copy of regulator export ZIPs (A-B12.5).
 */
@Injectable()
export class ExportWormService {
  private readonly logger = new Logger(ExportWormService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService<EnvironmentVariables, true>) {
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

  async putExportZip(
    localPath: string,
    manifestSha256: string,
  ): Promise<{ key: string } | null> {
    const key = `exports/${manifestSha256}.zip`;
    const body = await readFile(localPath);
    const retainUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: 'application/zip',
          ObjectLockMode: 'COMPLIANCE' satisfies ObjectLockMode,
          ObjectLockRetainUntilDate: retainUntil,
        }),
      );
      this.logger.log({ key }, 'Export ZIP stored in WORM');
      return { key };
    } catch (err) {
      this.logger.warn(
        { err, key },
        'Export WORM put failed (LocalStack may be unavailable)',
      );
      return null;
    }
  }
}
