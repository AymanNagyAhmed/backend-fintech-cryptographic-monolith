import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';

export interface TxOptions {
  /** Max wait for a pooled connection before the transaction starts. */
  maxWaitMs?: number;
  /** Max duration of the interactive transaction; Prisma rolls back after it. */
  timeoutMs?: number;
  /** Extra attempts after a write conflict or deadlock (Prisma P2034). */
  retries?: number;
}

const WRITE_CONFLICT = 'P2034';
const DEFAULT_TX: Required<TxOptions> = {
  maxWaitMs: 2_000,
  timeoutMs: 10_000,
  retries: 3,
};

// Runtime client as app_writer; the Prisma CLI uses MIGRATOR_DATABASE_URL via prisma.config.ts.
// Connects lazily, so the process starts (and /v1/health/live answers) while PostgreSQL is down.
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
        application_name: 'backend',
      }),
    });
  }

  /**
   * Runs `fn` in one interactive transaction. On a write conflict or deadlock the whole
   * transaction is retried, so `fn` may run more than once: keep non-database side effects
   * (HTTP calls, queue jobs) out of it and use the outbox instead.
   */
  async withTx<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = Prisma
      .TransactionIsolationLevel.ReadCommitted,
    options: TxOptions = {},
  ): Promise<T> {
    const { maxWaitMs, timeoutMs, retries } = { ...DEFAULT_TX, ...options };
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.$transaction(fn, {
          isolationLevel,
          maxWait: maxWaitMs,
          timeout: timeoutMs,
        });
      } catch (e) {
        if (!isWriteConflict(e) || attempt >= retries) throw e;
        this.logger.warn(
          { attempt: attempt + 1, isolationLevel },
          'Transaction write conflict, retrying',
        );
        await sleep(backoffMs(attempt));
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

function isWriteConflict(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError &&
    e.code === WRITE_CONFLICT
  );
}

// 20, 40, 80 ms ... plus jitter, so competing transactions do not retry in lockstep
function backoffMs(attempt: number): number {
  return 20 * 2 ** attempt + Math.floor(Math.random() * 20);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
