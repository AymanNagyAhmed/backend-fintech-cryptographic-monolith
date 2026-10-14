// Demo users with AED / USD / BTC wallets and opening balances, for local development.
// Everything goes through the services (UsersService, WalletsService.open, LedgerService.post),
// so the seed obeys the same rules as the API and the ledger stays reconciled. Re-runnable:
// existing users and "Main" wallets are reused, and each opening balance has a fixed ref.
import type { ConfigService } from '@nestjs/config';
import { DomainException } from '../src/common/exceptions/domain.exception.js';
import type { Currency } from '../src/common/money/currency.js';
import type { EnvironmentVariables } from '../src/config/env.validation.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { LedgerService } from '../src/modules/ledger/ledger.service.js';
import { PasswordHasher } from '../src/modules/users/password-hasher.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { WalletsService } from '../src/modules/wallets/wallets.service.js';

export interface SeedServices {
  prisma: PrismaService;
  users: UsersService;
  wallets: WalletsService;
  ledger: LedgerService;
}

/**
 * Built by hand like scripts/api-client.ts: tsx (esbuild) emits no decorator metadata, so
 * Nest cannot resolve constructor types outside the Nest CLI build and Vitest.
 */
export function createSeedServices(env: EnvironmentVariables): SeedServices {
  const config = {
    get: (key: keyof EnvironmentVariables) => env[key],
  } as unknown as ConfigService<EnvironmentVariables, true>;
  const prisma = new PrismaService(config);
  const ledger = new LedgerService(prisma);
  return {
    prisma,
    ledger,
    users: new UsersService(prisma, new PasswordHasher()),
    wallets: new WalletsService(prisma, ledger, config),
  };
}

export interface SeedUser {
  email: string;
  /** Opening balance per currency, a decimal string at the currency scale */
  balances: Partial<Record<Currency, string>>;
}

export const DEMO_USERS: SeedUser[] = [
  {
    email: 'alice@example.com',
    balances: { AED: '10000.00', USD: '2500.00', BTC: '0.50000000' },
  },
  {
    email: 'bob@example.com',
    balances: { AED: '5000.00', USD: '1000.00', BTC: '0.12500000' },
  },
];

export const SEED_WALLET_LABEL = 'Main';
/** Counter side of opening balances; goes negative by the total handed out */
export const openingBalanceAccountCode = (currency: Currency) =>
  `opening_balance:${currency.toLowerCase()}`;
export const openingBalanceRef = (walletId: string) =>
  `seed:opening:${walletId}`;

export interface SeedResult {
  email: string;
  userCreated: boolean;
  wallets: {
    currency: Currency;
    walletId: string;
    created: boolean;
    posted: boolean;
    balance: string;
  }[];
}

export async function seedDemoData(
  { users: usersService, wallets, ledger }: SeedServices,
  password: string,
  users: SeedUser[] = DEMO_USERS,
): Promise<SeedResult[]> {
  const results: SeedResult[] = [];

  for (const seedUser of users) {
    const existing = await usersService.findByEmail(seedUser.email);
    const user =
      existing ??
      (await usersService.create({ email: seedUser.email, password }));
    const result: SeedResult = {
      email: user.email,
      userCreated: !existing,
      wallets: [],
    };

    for (const [currency, amount] of Object.entries(seedUser.balances) as [
      Currency,
      string,
    ][]) {
      const owned = await wallets.listByOwner(user.id);
      let wallet = owned.find(
        (w) => w.currency === currency && w.label === SEED_WALLET_LABEL,
      );
      const created = !wallet;
      if (!wallet) {
        const dto = await wallets.open(user.id, {
          currency,
          label: SEED_WALLET_LABEL,
        });
        wallet = (await wallets.findOwned(dto.id, user.id))!;
      }

      const source = await ledger.ensureSystemAccount({
        code: openingBalanceAccountCode(currency),
        currency,
        allowNegative: true,
      });
      let posted = true;
      try {
        await ledger.post({
          ref: openingBalanceRef(wallet.id),
          entries: [
            { accountId: source.id, amount: `-${amount}` },
            { accountId: wallet.ledgerAccountId, amount },
          ],
        });
      } catch (e) {
        if (!(e instanceof DomainException && e.code === 'POSTING_EXISTS'))
          throw e;
        posted = false;
      }
      const balances = await ledger.getBalances([wallet.ledgerAccountId]);
      result.wallets.push({
        currency,
        walletId: wallet.id,
        created,
        posted,
        balance: balances.get(wallet.ledgerAccountId)!,
      });
    }
    results.push(result);
  }
  return results;
}
