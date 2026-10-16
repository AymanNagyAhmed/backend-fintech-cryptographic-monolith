const send = vi.fn().mockResolvedValue({ ETag: '"abc"' });

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send = send;
  },
  PutObjectCommand: class {
    input: unknown;
    constructor(input: unknown) {
      this.input = input;
    }
  },
}));

import { WormService } from './worm.service.js';

describe('WormService', () => {
  beforeEach(() => {
    send.mockClear();
  });

  it('puts a JSON batch with Object Lock compliance headers', async () => {
    const prisma = {
      treeHead: {
        findUnique: vi.fn().mockResolvedValue({
          treeSize: 2,
          rootHash: 'aa'.repeat(32),
          timestamp: new Date('2026-10-16T20:00:00Z'),
          previousSthHash: null,
          alg: 'ed25519',
          keyId: 'audit-signing:v1',
          signature: 'dGVzdA==',
          tsaToken: null,
        }),
      },
      auditEvent: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'e1',
            partitionKey: '0',
            seq: 1n,
            hash: 'aa'.repeat(32),
            prevHash: '0'.repeat(64),
            occurredAt: new Date(),
          },
        ]),
      },
    };
    const config = {
      get: (key: string) =>
        (
          ({
            WORM_BUCKET: 'audit-worm',
            AWS_REGION: 'us-east-1',
            S3_ENDPOINT: 'http://localhost:4566',
            AWS_ACCESS_KEY_ID: 'test',
            AWS_SECRET_ACCESS_KEY: 'test',
          }) as Record<string, string>
        )[key],
    };
    const service = new WormService(prisma as never, config as never);
    const result = await service.putBatch(2);
    expect(result.key).toBe('checkpoints/treeSize=2/batch.json');
    expect(result.skipped).toBe(false);
    expect(send).toHaveBeenCalledOnce();
  });
});
