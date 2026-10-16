import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { GENESIS_PREV_HASH, chainHash } from '../src/modules/audit/chain-hash.js';
import { WitnessService } from '../src/modules/checkpoints/witness.service.js';

// Done-when A-B10: deleting the last N leaves is detected via treeSize (2.3).
describe('Truncation / witness (database)', () => {
  let witness: WitnessService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
      ],
      providers: [WitnessService],
    }).compile();
    witness = moduleRef.get(WitnessService);
    prisma = moduleRef.get(PrismaService);
  });

  it('flags when fewer leaves remain than a published treeSize', async () => {
    const partition = `trunc-${randomUUID().slice(0, 8)}`;
    let prev = GENESIS_PREV_HASH;
    for (let i = 1; i <= 3; i++) {
      const payload = {
        type: 'transfer.completed',
        schemaVersion: 1,
        amount: String(i),
      };
      const hash = chainHash(prev, payload);
      await prisma.auditEvent.create({
        data: {
          partitionKey: partition,
          seq: BigInt(i),
          payload,
          prevHash: prev,
          hash,
          sourceContext: 'ledger',
          sourceId: randomUUID(),
          occurredAt: new Date(),
        },
      });
      prev = hash;
    }

    const realSize = await prisma.auditEvent.count();
    // Claim a larger tree than exists (as if the last 100 leaves were deleted).
    await prisma.treeHead.create({
      data: {
        treeSize: realSize + 100,
        rootHash: 'ff'.repeat(32),
        timestamp: new Date(),
        previousSthHash: null,
        alg: 'ed25519',
        keyId: 'audit-signing:v1',
        signature: 'dGVzdA==',
      },
    });

    const report = await witness.check();
    expect(report.ok).toBe(false);
    expect(report.forkAt?.reason).toMatch(/leaves/);
  });
});
