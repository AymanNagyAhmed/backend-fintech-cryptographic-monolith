import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env.validation.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

const config = {
  get: () => 'postgresql://app_writer:x@localhost:5433/fintech',
} as unknown as ConfigService<EnvironmentVariables, true>;

const knownError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`error ${code}`, {
    code,
    clientVersion: 'test',
  });

describe('PrismaService.withTx', () => {
  let prisma: PrismaService;
  let transaction: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Constructing the client does not connect; $transaction is replaced, so no database is needed
    prisma = new PrismaService(config);
    transaction = vi.fn();
    (prisma as unknown as { $transaction: unknown }).$transaction = transaction;
  });

  it('defaults to ReadCommitted and passes the timeouts', async () => {
    transaction.mockResolvedValue('ok');
    await expect(prisma.withTx(async () => 'ok')).resolves.toBe('ok');
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 2_000,
      timeout: 10_000,
    });
  });

  it('passes the requested isolation level and options', async () => {
    transaction.mockResolvedValue(1);
    await prisma.withTx(
      async () => 1,
      Prisma.TransactionIsolationLevel.Serializable,
      { timeoutMs: 500 },
    );
    expect(transaction.mock.calls[0][1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 500,
    });
  });

  it('retries a write conflict or deadlock (P2034) and returns the later result', async () => {
    transaction
      .mockRejectedValueOnce(knownError('P2034'))
      .mockRejectedValueOnce(knownError('P2034'))
      .mockResolvedValue('done');
    await expect(prisma.withTx(async () => 'done')).resolves.toBe('done');
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up after the configured retries and rethrows the conflict', async () => {
    transaction.mockRejectedValue(knownError('P2034'));
    await expect(
      prisma.withTx(async () => 1, undefined, { retries: 2 }),
    ).rejects.toMatchObject({ code: 'P2034' });
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    transaction.mockRejectedValue(knownError('P2002'));
    await expect(prisma.withTx(async () => 1)).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
