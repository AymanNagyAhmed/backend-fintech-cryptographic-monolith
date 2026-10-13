import type { Redis } from 'ioredis';
import { RateLimitUnavailableException } from './exceptions/rate-limit-unavailable.exception.js';
import { RedisThrottlerStorage } from './redis-throttler.storage.js';

// The Lua script itself runs against the Compose Redis in test/rate-limit.e2e-spec.ts
const fakeRedis = (reply: () => Promise<unknown>) => {
  const fake = {
    status: 'ready',
    defineCommand: vi.fn(),
    throttleIncrement: vi.fn(reply),
    quit: vi.fn(async () => 'OK'),
    disconnect: vi.fn(),
  };
  return fake;
};

describe('RedisThrottlerStorage', () => {
  it('registers a two-key script and passes keys sharing one cluster hash tag', async () => {
    const redis = fakeRedis(async () => [1, 60_000, 0]);
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);
    expect(redis.defineCommand).toHaveBeenCalledWith(
      'throttleIncrement',
      expect.objectContaining({ numberOfKeys: 2 }),
    );

    await storage.increment('abc', 60_000, 10, 300_000, 'default');
    expect(redis.throttleIncrement).toHaveBeenCalledWith(
      'throttle:default:{abc}:hits',
      'throttle:default:{abc}:block',
      60_000,
      10,
      300_000,
    );
  });

  it('maps an allowed hit, rounding milliseconds up to seconds', async () => {
    const storage = new RedisThrottlerStorage(
      fakeRedis(async () => [3, 59_001, 0]) as unknown as Redis,
    );
    await expect(
      storage.increment('k', 60_000, 10, 60_000, 'default'),
    ).resolves.toEqual({
      totalHits: 3,
      timeToExpire: 60,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('maps a blocked key', async () => {
    const storage = new RedisThrottlerStorage(
      fakeRedis(async () => [11, 299_500, 299_500]) as unknown as Redis,
    );
    await expect(
      storage.increment('k', 60_000, 10, 300_000, 'default'),
    ).resolves.toEqual({
      totalHits: 11,
      timeToExpire: 300,
      isBlocked: true,
      timeToBlockExpire: 300,
    });
  });

  it('fails closed with 503 RATE_LIMIT_UNAVAILABLE when Redis errors', async () => {
    const storage = new RedisThrottlerStorage(
      fakeRedis(async () => {
        throw new Error('Command timed out');
      }) as unknown as Redis,
    );
    const err = await storage
      .increment('k', 60_000, 10, 60_000, 'default')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitUnavailableException);
    expect(err).toMatchObject({
      code: 'RATE_LIMIT_UNAVAILABLE',
      statusCode: 503,
      expose: true,
    });
    expect((err as Error).message).not.toContain('timed out');
  });

  it('closes the connection once on shutdown', async () => {
    const redis = fakeRedis(async () => [1, 1, 0]);
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);
    await storage.onModuleDestroy();
    expect(redis.quit).toHaveBeenCalledOnce();

    redis.status = 'end';
    await storage.onModuleDestroy();
    expect(redis.quit).toHaveBeenCalledOnce();
  });
});
