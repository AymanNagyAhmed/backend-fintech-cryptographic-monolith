import { randomUUID } from 'node:crypto';
import {
  SEED_WALLET_LABEL,
  createSeedServices,
  openingBalanceAccountCode,
  openingBalanceRef,
  seedDemoData,
  type SeedServices,
  type SeedUser,
} from '../scripts/seed.js';
import { validate } from '../src/config/env.validation.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { ReconciliationService } from '../src/modules/ledger/reconciliation.service.js';

// Needs the Compose PostgreSQL (`make up`). Uses its own e2e users, not the demo users.
describe('Seed (database)', () => {
  let services: SeedServices;
  let prisma: PrismaService;
  const password = 'seed-e2e-password-1';
  const users: SeedUser[] = [
    {
      email: `e2e-seed-${randomUUID()}@example.com`,
      balances: { AED: '100.00', BTC: '0.00000001' },
    },
    {
      email: `e2e-seed-${randomUUID()}@example.com`,
      balances: { USD: '7.50' },
    },
  ];

  beforeAll(() => {
    process.loadEnvFile('.env');
    services = createSeedServices(validate(process.env));
    prisma = services.prisma;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates users, "Main" wallets and opening balances, then a second run changes nothing', async () => {
    const first = await seedDemoData(services, password, users);
    expect(first.map((r) => r.userCreated)).toEqual([true, true]);
    expect(first[0].wallets).toEqual([
      expect.objectContaining({
        currency: 'AED',
        created: true,
        posted: true,
        balance: '100.00',
      }),
      expect.objectContaining({
        currency: 'BTC',
        created: true,
        posted: true,
        balance: '0.00000001',
      }),
    ]);
    expect(first[1].wallets).toEqual([
      expect.objectContaining({ currency: 'USD', balance: '7.50' }),
    ]);

    const second = await seedDemoData(services, password, users);
    expect(second.map((r) => r.userCreated)).toEqual([false, false]);
    for (const [i, r] of second.entries())
      for (const [j, w] of r.wallets.entries())
        expect(w).toEqual({
          ...first[i].wallets[j],
          created: false,
          posted: false,
        });

    const walletIds = first.flatMap((r) => r.wallets.map((w) => w.walletId));
    const wallets = await prisma.wallet.findMany({
      where: { id: { in: walletIds } },
    });
    expect(wallets.every((w) => w.label === SEED_WALLET_LABEL)).toBe(true);
    const entries = await prisma.ledgerEntry.count({
      where: { ref: { in: walletIds.map(openingBalanceRef) } },
    });
    expect(entries).toBe(walletIds.length * 2);
  });

  it('users can log in with the seed password; opening balances come from system accounts', async () => {
    await seedDemoData(services, password, users);
    const user = await services.users.verifyCredentials(
      users[0].email,
      password,
    );
    expect(user?.email).toBe(users[0].email);

    const source = await prisma.account.findUnique({
      where: { code: openingBalanceAccountCode('AED') },
    });
    expect(source).toMatchObject({ kind: 'system', allowNegative: true });
    expect(source!.balance.isNegative()).toBe(true);
  });

  it('leaves the ledger reconciled', async () => {
    await seedDemoData(services, password, users);
    const report = await new ReconciliationService(prisma).run();
    expect(report.ok).toBe(true);
  });
});
