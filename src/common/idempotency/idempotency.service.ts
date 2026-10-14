import { HttpStatus, Injectable } from '@nestjs/common';
import {
  PrismaService,
  type TxOptions,
} from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { claimIdempotencyKey } from '../../generated/prisma/sql.js';
import {
  canonicalJson,
  canonicalJsonSha256,
} from '../crypto/canonical-json.js';
import {
  idempotencyKeyInUse,
  idempotencyKeyReused,
} from './exceptions/idempotency.exceptions.js';
import {
  assertIdempotencyKey,
  assertIdempotencyScope,
} from './idempotency-key.js';
import type { IdempotentResponse } from './interfaces/idempotent-response.interface.js';

export interface RunOnceOptions {
  /** HTTP status stored with the result and replayed (default 200). */
  statusCode?: number;
  /** Default ReadCommitted; stricter levels turn a concurrent claim into a retried conflict. */
  isolationLevel?: Prisma.TransactionIsolationLevel;
  tx?: TxOptions;
}

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs `work` once per (scope, key), also across retries, concurrent calls and crashes
   * (2.10, 2.17). One transaction: claim the key (INSERT ... ON CONFLICT DO NOTHING), run
   * `work` with that transaction, store its result. If `work` throws, the claim rolls back with
   * the money movement and a retry runs it again. A call that finds the key replays the stored
   * result, or fails with IDEMPOTENCY_KEY_REUSED when `request` hashes differently
   * (SHA-256 over RFC 8785 canonical JSON). The transaction may be retried after a deadlock,
   * so `work` must only write to the database (side effects go through the outbox).
   */
  async runOnce<T>(
    scope: string,
    key: string,
    request: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    options: RunOnceOptions = {},
  ): Promise<IdempotentResponse<T>> {
    assertIdempotencyScope(scope);
    assertIdempotencyKey(key);
    const requestHash = canonicalJsonSha256(request);
    const statusCode = options.statusCode ?? HttpStatus.OK;
    return this.prisma.withTx(
      async (tx) => {
        const [claim] = await tx.$queryRawTyped(
          claimIdempotencyKey(scope, key, requestHash),
        );
        if (!claim) return replay<T>(tx, scope, key, requestHash);
        const body = toJson(await work(tx));
        await tx.idempotencyKey.update({
          where: { id: claim.id },
          data: { statusCode, response: body ?? Prisma.JsonNull },
        });
        return { statusCode, body: body as T, replayed: false };
      },
      options.isolationLevel,
      options.tx,
    );
  }
}

// Under ReadCommitted this statement sees the row the competing transaction committed
async function replay<T>(
  tx: Prisma.TransactionClient,
  scope: string,
  key: string,
  requestHash: string,
): Promise<IdempotentResponse<T>> {
  const stored = await tx.idempotencyKey.findUnique({
    where: { scope_key: { scope, key } },
    select: { requestHash: true, statusCode: true, response: true },
  });
  if (stored && stored.requestHash !== requestHash)
    throw idempotencyKeyReused();
  if (!stored || stored.statusCode === null) throw idempotencyKeyInUse();
  return {
    statusCode: stored.statusCode,
    body: toJson(stored.response) as T,
    replayed: true,
  };
}

/**
 * Plain JSON (dates and decimals as strings) with keys in canonical order, on the first call
 * and on replays alike: JSONB stores keys in its own order, so the serialized responses would
 * otherwise differ.
 */
function toJson(value: unknown): Prisma.InputJsonValue | null {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue | null;
}
