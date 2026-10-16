import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getRequestId } from '../../common/request-context.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { SignatureEnvelope } from '../crypto/signer.js';
import { SignerService } from '../crypto/signer.service.js';
import { OutboxService } from '../outbox/outbox.service.js';

export interface CustodySignRequest {
  /** Stable id of the withdrawal (or other custody operation). */
  operationId: string;
  operationType: 'withdrawal';
  actorId: string;
  /** Canonical payload fields that must be signed (sorted keys, no floats). */
  payload: Record<string, string>;
}

export interface CustodySignResult {
  signature: SignatureEnvelope;
  payloadHash: string;
}

/**
 * Non-exportable custody signing via KMS/HSM-backed Signer (OpenBao Transit / AWS KMS).
 * Every request is audited. MPC / threshold signing is the production target
 * (see docs/custody-mpc.md).
 */
@Injectable()
export class CustodySignerService {
  private readonly keyRef: string;

  constructor(
    private readonly signer: SignerService,
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.keyRef = config.get('CUSTODY_SIGNING_KEY_NAME', { infer: true });
  }

  async sign(request: CustodySignRequest): Promise<CustodySignResult> {
    const canonical = canonicalize(request.payload);
    const bytes = Buffer.from(canonical, 'utf8');
    const payloadHash = createHash('sha256').update(bytes).digest('hex');
    const signature = await this.signer.sign(bytes, this.keyRef);
    const occurredAt = new Date().toISOString();
    const requestId = getRequestId();

    await this.prisma.withTx(async (tx) => {
      await this.outbox.enqueue(tx, 'withdrawals', {
        type: 'custody.sign',
        schemaVersion: 1,
        occurredAt,
        actor: { subjectRef: request.actorId },
        ...(requestId !== undefined ? { requestId } : {}),
        partitionKey: request.actorId,
        operationId: request.operationId,
        operationType: request.operationType,
        payloadHash,
        keyId: signature.keyId,
        alg: signature.alg,
      });
    });

    return { signature, payloadHash };
  }
}

/** Deterministic JSON: sorted keys, string values only. */
export function canonicalize(payload: Record<string, string>): string {
  const keys = Object.keys(payload).sort();
  const obj: Record<string, string> = {};
  for (const k of keys) obj[k] = payload[k];
  return JSON.stringify(obj);
}
