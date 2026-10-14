import type { QueueOptions } from 'bullmq';

/**
 * Shared BullMQ settings. Each queue and worker opens its own connection from these options
 * (a worker needs a blocking one). `maxRetriesPerRequest: null` is what BullMQ requires for
 * workers: commands wait for Redis to come back instead of failing the job.
 */
export function queueOptions(redisUrl: string): QueueOptions {
  return {
    connection: {
      url: redisUrl,
      connectionName: 'backend-bullmq',
      maxRetriesPerRequest: null,
    },
    prefix: 'bull',
  };
}
