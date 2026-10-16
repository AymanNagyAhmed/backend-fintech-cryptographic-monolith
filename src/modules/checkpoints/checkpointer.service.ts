import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { SignerService } from '../crypto/signer.service.js';
import {
  auditLeafDigest,
  merkleHashToHex,
  merkleRoot,
} from './merkle.js';
import {
  sthCanonicalBytes,
  sthContentHash,
  type SthPayload,
} from './sth-payload.js';

export interface CheckpointBuildResult {
  treeSize: number;
  rootHash: string;
  fromEventId: string | null;
  toEventId: string | null;
  empty: boolean;
  /** Set when a new STH row was inserted (or already existed for this treeSize). */
  sthId?: string;
  skipped?: boolean;
}

/**
 * Builds an RFC 6962 Merkle tree over chained audit leaves and persists a signed
 * tree head when the tree grew (A-B10.1 / A-B10.2).
 */
@Injectable()
export class CheckpointerService {
  private readonly logger = new Logger(CheckpointerService.name);
  private readonly keyRef: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly signer: SignerService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.keyRef = config.get('SIGNING_KEY_NAME', { infer: true });
  }

  /** Build Merkle root over all audit events (ordered) and sign a new STH if grown. */
  async build(): Promise<CheckpointBuildResult> {
    const rows = await this.prisma.auditEvent.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, hash: true },
    });
    if (rows.length === 0) {
      return {
        treeSize: 0,
        rootHash: '',
        fromEventId: null,
        toEventId: null,
        empty: true,
      };
    }
    const digests = rows.map((r) => auditLeafDigest(r.hash));
    const rootHash = merkleHashToHex(merkleRoot(digests, true));
    const treeSize = rows.length;
    const latest = await this.prisma.treeHead.findFirst({
      orderBy: { treeSize: 'desc' },
    });
    if (latest && latest.treeSize >= treeSize) {
      return {
        treeSize,
        rootHash,
        fromEventId: rows[0]!.id,
        toEventId: rows[rows.length - 1]!.id,
        empty: false,
        sthId: latest.id,
        skipped: true,
      };
    }

    const previousPayload: SthPayload | null = latest
      ? {
          treeSize: latest.treeSize,
          rootHash: latest.rootHash,
          timestamp: latest.timestamp.toISOString(),
          previousSthHash: latest.previousSthHash,
        }
      : null;
    const timestamp = new Date();
    const payload: SthPayload = {
      treeSize,
      rootHash,
      timestamp: timestamp.toISOString(),
      previousSthHash: previousPayload
        ? sthContentHash(previousPayload)
        : null,
    };
    const envelope = await this.signer.sign(
      sthCanonicalBytes(payload),
      this.keyRef,
    );

    try {
      const row = await this.prisma.treeHead.create({
        data: {
          treeSize,
          rootHash,
          timestamp,
          previousSthHash: payload.previousSthHash,
          alg: envelope.alg,
          keyId: envelope.keyId,
          signature: envelope.sig,
        },
      });
      this.logger.log(
        { treeSize, rootHash, sthId: row.id },
        'Signed tree head stored',
      );
      return {
        treeSize,
        rootHash,
        fromEventId: rows[0]!.id,
        toEventId: rows[rows.length - 1]!.id,
        empty: false,
        sthId: row.id,
      };
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const existing = await this.prisma.treeHead.findUniqueOrThrow({
          where: { treeSize },
        });
        return {
          treeSize,
          rootHash: existing.rootHash,
          fromEventId: rows[0]!.id,
          toEventId: rows[rows.length - 1]!.id,
          empty: false,
          sthId: existing.id,
          skipped: true,
        };
      }
      throw e;
    }
  }
}
