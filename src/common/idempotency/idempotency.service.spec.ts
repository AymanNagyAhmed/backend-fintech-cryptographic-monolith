import type { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { canonicalJsonSha256 } from '../crypto/canonical-json.js';
import { Decimal } from '../money/decimal.js';
import { IdempotencyService } from './idempotency.service.js';

describe('IdempotencyService.runOnce', () => {
  const scope = 'transfer:u1';
  const key = 'key-1';
  const request = { amount: '10.00', to: 'w2' };
  let tx: {
    $queryRawTyped: ReturnType<typeof vi.fn>;
    idempotencyKey: Record<'update' | 'findUnique', ReturnType<typeof vi.fn>>;
  };
  let withTx: ReturnType<typeof vi.fn>;
  let service: IdempotencyService;

  const claimed = () => tx.$queryRawTyped.mockResolvedValue([{ id: 'k1' }]);
  const conflict = (stored: object | null) => {
    tx.$queryRawTyped.mockResolvedValue([]);
    tx.idempotencyKey.findUnique.mockResolvedValue(stored);
  };
  const claimArgs = () =>
    (tx.$queryRawTyped.mock.calls[0][0] as { values: unknown[] }).values;

  beforeEach(() => {
    tx = {
      $queryRawTyped: vi.fn(),
      idempotencyKey: { update: vi.fn(), findUnique: vi.fn() },
    };
    withTx = vi.fn((fn: (t: unknown) => unknown) => fn(tx));
    service = new IdempotencyService({ withTx } as unknown as PrismaService);
  });

  it('claims the key, runs work in the same transaction and stores the JSON result', async () => {
    claimed();
    const work = vi.fn().mockResolvedValue({
      id: 't1',
      amount: new Decimal('10.00'),
      createdAt: new Date('2026-10-14T10:00:00Z'),
    });
    const result = await service.runOnce(scope, key, request, work, {
      statusCode: 201,
    });
    const body = {
      id: 't1',
      amount: '10',
      createdAt: '2026-10-14T10:00:00.000Z',
    };
    expect(claimArgs()).toEqual([scope, key, canonicalJsonSha256(request)]);
    expect(work).toHaveBeenCalledWith(tx);
    expect(tx.idempotencyKey.update).toHaveBeenCalledWith({
      where: { id: 'k1' },
      data: { statusCode: 201, response: body },
    });
    expect(result).toEqual({ statusCode: 201, body, replayed: false });
  });

  it('hashes the canonical request, so key order does not matter', async () => {
    claimed();
    await service.runOnce(
      scope,
      key,
      { b: 1, a: 2 },
      vi.fn().mockResolvedValue({}),
    );
    expect(claimArgs()[2]).toBe(canonicalJsonSha256({ a: 2, b: 1 }));
  });

  it('defaults to 200 and stores a null result as JSON null', async () => {
    claimed();
    const result = await service.runOnce(scope, key, request, () =>
      Promise.resolve(null),
    );
    expect(tx.idempotencyKey.update.mock.calls[0][0].data).toEqual({
      statusCode: 200,
      response: Prisma.JsonNull,
    });
    expect(result).toEqual({ statusCode: 200, body: null, replayed: false });
  });

  it('replays the stored result without running work again', async () => {
    conflict({
      requestHash: canonicalJsonSha256(request),
      statusCode: 201,
      response: { id: 't1' },
    });
    const work = vi.fn();
    await expect(service.runOnce(scope, key, request, work)).resolves.toEqual({
      statusCode: 201,
      body: { id: 't1' },
      replayed: true,
    });
    expect(work).not.toHaveBeenCalled();
    expect(tx.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('replays with keys in canonical order like the first call (JSONB reorders keys)', async () => {
    conflict({
      requestHash: canonicalJsonSha256(request),
      statusCode: 201,
      response: { ref: 'r1', amount: '10.00' },
    });
    const { body } = await service.runOnce(scope, key, request, vi.fn());
    expect(JSON.stringify(body)).toBe('{"amount":"10.00","ref":"r1"}');
  });

  it('rejects the same key with a different request (422 IDEMPOTENCY_KEY_REUSED)', async () => {
    conflict({
      requestHash: canonicalJsonSha256({ ...request, amount: '11.00' }),
      statusCode: 201,
      response: { id: 't1' },
    });
    const work = vi.fn();
    await expect(
      service.runOnce(scope, key, request, work),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      statusCode: 422,
    });
    expect(work).not.toHaveBeenCalled();
  });

  it.each([
    [
      'without a stored result',
      {
        requestHash: canonicalJsonSha256(request),
        statusCode: null,
        response: null,
      },
    ],
    ['that was purged meanwhile', null],
  ])('answers 409 IDEMPOTENCY_KEY_IN_USE for a key %s', async (_, stored) => {
    conflict(stored);
    await expect(
      service.runOnce(scope, key, request, vi.fn()),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_IN_USE',
      statusCode: 409,
    });
  });

  it('propagates a failure of work and stores nothing (the claim rolls back with it)', async () => {
    claimed();
    const failure = new Error('insufficient funds');
    await expect(
      service.runOnce(scope, key, request, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
    expect(tx.idempotencyKey.update).not.toHaveBeenCalled();
  });

  it('checks key and scope before opening a transaction', async () => {
    await expect(
      service.runOnce(scope, 'has space', request, vi.fn()),
    ).rejects.toMatchObject({
      code: 'INVALID_IDEMPOTENCY_KEY',
      statusCode: 400,
    });
    await expect(
      service.runOnce('Bad Scope', key, request, vi.fn()),
    ).rejects.toThrow(/Invalid idempotency scope/);
    expect(withTx).not.toHaveBeenCalled();
  });

  it('passes the isolation level and transaction options to withTx', async () => {
    claimed();
    await service.runOnce(scope, key, request, vi.fn().mockResolvedValue({}), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      tx: { timeoutMs: 500 },
    });
    expect(withTx).toHaveBeenCalledWith(
      expect.any(Function),
      Prisma.TransactionIsolationLevel.Serializable,
      { timeoutMs: 500 },
    );
  });
});
