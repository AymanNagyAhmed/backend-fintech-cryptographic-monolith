import type { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { PrismaService } from '../../database/prisma.service.js';
import type { SignerService } from '../crypto/signer.service.js';
import type { OutboxService } from '../outbox/outbox.service.js';
import {
  canonicalize,
  CustodySignerService,
} from './custody-signer.service.js';

describe('canonicalize', () => {
  it('sorts keys', () => {
    expect(canonicalize({ b: '2', a: '1' })).toBe('{"a":"1","b":"2"}');
  });
});

describe('CustodySignerService', () => {
  it('signs via SignerService and audits custody.sign', async () => {
    const sign = vi.fn().mockResolvedValue({
      alg: 'ed25519',
      keyId: 'custody-signing:v1',
      sig: Buffer.alloc(64, 1).toString('base64'),
    });
    const enqueue = vi.fn().mockResolvedValue('ob1');
    const withTx = vi.fn((fn: (t: unknown) => unknown) => fn({}));
    const service = new CustodySignerService(
      { sign } as unknown as SignerService,
      { withTx } as unknown as PrismaService,
      { enqueue } as unknown as OutboxService,
      {
        get: vi.fn().mockReturnValue('custody-signing'),
      } as unknown as ConfigService<EnvironmentVariables, true>,
    );

    const result = await service.sign({
      operationId: '0199c1a0-0000-7000-8000-0000000000c1',
      operationType: 'withdrawal',
      actorId: '0199c1a0-0000-7000-8000-000000000001',
      payload: {
        amount: '10.00',
        currency: 'AED',
        beneficiaryId: '0199c1a0-0000-7000-8000-0000000000b1',
      },
    });

    expect(result.signature.keyId).toBe('custody-signing:v1');
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(sign).toHaveBeenCalledWith(expect.any(Uint8Array), 'custody-signing');
    expect(enqueue).toHaveBeenCalledWith(
      expect.anything(),
      'withdrawals',
      expect.objectContaining({
        type: 'custody.sign',
        keyId: 'custody-signing:v1',
      }),
    );
  });
});
