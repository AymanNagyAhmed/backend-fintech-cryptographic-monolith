import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validate } from '../src/config/env.validation.js';
import { DatabaseModule } from '../src/database/database.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';

// Needs the Compose PostgreSQL (`make up`) with the A-B3 roles and migrations applied
describe('PrismaService (database)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, validate }),
        DatabaseModule,
      ],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('connects as the runtime role app_writer', async () => {
    const [row] = await prisma.$queryRaw<
      { current_user: string }[]
    >`SELECT current_user`;
    expect(row.current_user).toBe('app_writer');
  });

  it('app_writer cannot run DDL in a bounded-context schema', async () => {
    await expect(
      prisma.$executeRaw`CREATE TABLE auth.should_fail (id int)`,
    ).rejects.toThrow(/permission denied/);
  });

  it.each([
    [undefined, 'read committed'],
    [Prisma.TransactionIsolationLevel.RepeatableRead, 'repeatable read'],
    [Prisma.TransactionIsolationLevel.Serializable, 'serializable'],
  ])('withTx(%s) runs at isolation level %s', async (level, expected) => {
    const [row] = await prisma.withTx(
      (tx) =>
        tx.$queryRaw<
          { transaction_isolation: string }[]
        >`SHOW transaction_isolation`,
      level,
    );
    expect(row.transaction_isolation).toBe(expected);
  });
});
