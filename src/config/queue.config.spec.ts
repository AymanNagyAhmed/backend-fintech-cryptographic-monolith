import { queueOptions } from './queue.config.js';

describe('queueOptions', () => {
  it('connects by URL with the retry setting BullMQ workers require', () => {
    expect(queueOptions('redis://:pw@localhost:6379')).toEqual({
      connection: {
        url: 'redis://:pw@localhost:6379',
        connectionName: 'backend-bullmq',
        maxRetriesPerRequest: null,
      },
      prefix: 'bull',
    });
  });
});
