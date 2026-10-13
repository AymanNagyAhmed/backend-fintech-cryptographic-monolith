import { Logger, type OnModuleDestroy } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { RateLimitUnavailableException } from './exceptions/rate-limit-unavailable.exception.js';

type ThrottlerStorageRecord = Awaited<
  ReturnType<ThrottlerStorage['increment']>
>;

export const THROTTLE_KEY_PREFIX = 'throttle:';

/**
 * Fixed window per key, atomic in one script (a MULTI cannot branch on the count).
 * KEYS[1] hit counter, KEYS[2] block marker; ARGV ttl ms, limit, block ms.
 * Returns { totalHits, ms until the window or block ends, ms blocked (0 = allowed) }.
 */
const INCREMENT_LUA = `
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local block = tonumber(ARGV[3])
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then
  return { tonumber(redis.call('GET', KEYS[2])), blocked, blocked }
end
local hits = redis.call('INCR', KEYS[1])
local left = redis.call('PTTL', KEYS[1])
if left < 0 then
  redis.call('PEXPIRE', KEYS[1], ttl)
  left = ttl
end
if hits <= limit then
  return { hits, left, 0 }
end
if block > 0 then
  redis.call('SET', KEYS[2], hits, 'PX', block)
  redis.call('DEL', KEYS[1])
  return { hits, block, block }
end
return { hits, left, left }
`;

type IncrementReply = [totalHits: number, leftMs: number, blockedMs: number];

interface ThrottleCommands {
  throttleIncrement(
    hitsKey: string,
    blockKey: string,
    ttlMs: number,
    limit: number,
    blockMs: number,
  ): Promise<IncrementReply>;
}

const toSeconds = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

/** `ThrottlerStorage` on Redis, so limits hold across instances and restarts. */
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis & ThrottleCommands;

  constructor(redis: Redis) {
    redis.defineCommand('throttleIncrement', {
      numberOfKeys: 2,
      lua: INCREMENT_LUA,
    });
    this.redis = redis as Redis & ThrottleCommands;
  }

  static fromUrl(url: string): RedisThrottlerStorage {
    const redis = new Redis(url, {
      connectionName: 'backend-throttler',
      // A request waits at most this long for a verdict, also while Redis is down
      maxRetriesPerRequest: 1,
      commandTimeout: 1_000,
      retryStrategy: (times) => Math.min(times * 200, 2_000),
    });
    const storage = new RedisThrottlerStorage(redis);
    redis.on('error', (err) =>
      storage.logger.warn({ err }, 'Redis throttler connection error'),
    );
    return storage;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Hash tag keeps both keys in one Redis Cluster slot
    const base = `${THROTTLE_KEY_PREFIX}${throttlerName}:{${key}}`;
    let reply: IncrementReply;
    try {
      reply = await this.redis.throttleIncrement(
        `${base}:hits`,
        `${base}:block`,
        ttl,
        limit,
        blockDuration,
      );
    } catch (err) {
      // Fail closed: without Redis no request is checked, so none is let through
      this.logger.error({ err }, 'Rate limit check failed');
      throw new RateLimitUnavailableException();
    }
    const [totalHits, leftMs, blockedMs] = reply;
    return {
      totalHits,
      timeToExpire: toSeconds(leftMs),
      isBlocked: blockedMs > 0,
      timeToBlockExpire: toSeconds(blockedMs),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis.status === 'end') return;
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
