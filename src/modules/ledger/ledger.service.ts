import { Injectable } from '@nestjs/common';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountKind,
  Prisma,
  type Account,
} from '../../generated/prisma/client.js';
import { systemAccountMismatch } from './exceptions/ledger.exceptions.js';

export type AccountView = Omit<Account, 'currency'> & { currency: Currency };

export interface SystemAccountInput {
  /** Stable name, e.g. "external_clearing:AED" (CHECK accounts_code_chk) */
  code: string;
  currency: string;
  /** Counter side of deposits / opening balances goes below zero */
  allowNegative?: boolean;
}

const toView = (account: Account) => account as AccountView;

function assertCurrency(currency: string): asserts currency is Currency {
  if (!isCurrency(currency)) throw new UnsupportedCurrencyException(currency);
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /** Account behind one wallet.wallets row; open it in the wallet's transaction. */
  async openWalletAccount(
    currency: string,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AccountView> {
    assertCurrency(currency);
    return toView(
      await tx.account.create({
        data: { currency, kind: AccountKind.wallet },
      }),
    );
  }

  /**
   * Returns the system account with this code, creating it on first use. Concurrent first
   * calls are safe (upsert on the unique code). An existing account with another currency or
   * allowNegative is a configuration error, never silently reused.
   */
  async ensureSystemAccount(
    input: SystemAccountInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<AccountView> {
    assertCurrency(input.currency);
    const allowNegative = input.allowNegative ?? false;
    const account = await tx.account.upsert({
      where: { code: input.code },
      create: {
        code: input.code,
        currency: input.currency,
        kind: AccountKind.system,
        allowNegative,
      },
      update: {},
    });
    if (
      account.currency !== input.currency ||
      account.allowNegative !== allowNegative
    )
      throw systemAccountMismatch(input.code);
    return toView(account);
  }

  async findById(id: string): Promise<AccountView | null> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    return account && toView(account);
  }
}
