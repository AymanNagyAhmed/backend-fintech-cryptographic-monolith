import { Injectable } from '@nestjs/common';
import {
  CURRENCY_SCALE,
  isCurrency,
  type Currency,
} from '../../common/money/currency.js';
import { Decimal } from '../../common/money/decimal.js';
import { CurrencyMismatchException } from '../../common/money/exceptions/currency-mismatch.exception.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { Money } from '../../common/money/money.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  AccountKind,
  AccountStatus,
  Prisma,
  type Account,
} from '../../generated/prisma/client.js';
import { lockAccountsForUpdate } from '../../generated/prisma/sql.js';
import {
  accountNotActive,
  accountNotFound,
  insufficientFunds,
  postingExists,
  systemAccountMismatch,
} from './exceptions/ledger.exceptions.js';
import {
  parsePosting,
  type ParsedPosting,
  type PostingInput,
} from './posting.js';

export type AccountView = Omit<Account, 'currency'> & { currency: Currency };

export interface PostingResult {
  ref: string;
  currency: Currency;
  entries: {
    id: string;
    seq: bigint;
    accountId: string;
    amount: Prisma.Decimal;
  }[];
  /** Balance of every touched account after the posting */
  balances: { accountId: string; balance: Decimal }[];
}

const UNIQUE_VIOLATION = 'P2002';

export interface SystemAccountInput {
  /** Stable name, e.g. "external_clearing:aed" (CHECK accounts_code_chk) */
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

  /**
   * The only code that changes a balance. In one transaction: claims the ref (ledger.postings
   * PK, so a ref posts once), locks the accounts in id order (SELECT ... FOR UPDATE), checks
   * currency, status, scale and funds, inserts the entries and sets the cached balances.
   * Without `tx` it opens its own transaction; with `tx` the caller's transaction holds the
   * locks until it commits, so pass the transaction that also writes the business rows.
   */
  post(
    input: PostingInput,
    tx?: Prisma.TransactionClient,
  ): Promise<PostingResult> {
    const posting = parsePosting(input);
    return tx
      ? this.postIn(tx, posting)
      : this.prisma.withTx((t) => this.postIn(t, posting));
  }

  private async postIn(
    tx: Prisma.TransactionClient,
    posting: ParsedPosting,
  ): Promise<PostingResult> {
    try {
      await tx.posting.create({ data: { ref: posting.ref } });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === UNIQUE_VIOLATION
      )
        throw postingExists(posting.ref);
      throw e;
    }

    const locked = await tx.$queryRawTyped(
      lockAccountsForUpdate(posting.accountIds),
    );
    const byId = new Map(locked.map((a) => [a.id, a]));
    const missing = posting.accountIds.find((id) => !byId.has(id));
    if (missing) throw accountNotFound(missing);

    const currency = locked[0].currency as Currency;
    for (const account of locked) {
      if (account.currency !== currency)
        throw new CurrencyMismatchException(
          currency,
          account.currency as Currency,
        );
      if (account.status !== AccountStatus.active)
        throw accountNotActive(account.id, account.status);
    }
    // Scale per currency (e.g. 2 for AED) and the 12 integer digits of NUMERIC(20, 8)
    for (const e of posting.entries) Money.of(e.amount, currency);

    const balances = posting.accountIds.map((id) => {
      const account = byId.get(id)!;
      const before = new Decimal(account.balance.toString());
      const after = Money.of(
        before.plus(posting.netByAccount.get(id)!),
        currency,
      ).amount;
      if (after.isNegative() && !account.allow_negative)
        throw insufficientFunds(
          posting.netByAccount
            .get(id)!
            .negated()
            .toFixed(CURRENCY_SCALE[currency]),
          before.toFixed(CURRENCY_SCALE[currency]),
        );
      return { accountId: id, balance: after };
    });

    const entries = await tx.ledgerEntry.createManyAndReturn({
      data: posting.entries.map((e) => ({
        accountId: e.accountId,
        amount: e.amount.toFixed(),
        currency,
        ref: posting.ref,
      })),
      select: { id: true, seq: true, accountId: true, amount: true },
    });
    for (const b of balances)
      await tx.account.update({
        where: { id: b.accountId },
        data: { balance: b.balance.toFixed() },
      });

    return { ref: posting.ref, currency, entries, balances };
  }

  async findById(id: string): Promise<AccountView | null> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    return account && toView(account);
  }

  /**
   * Cached balances by account id, read without locks (for display; `post` re-reads under
   * the lock). Formatted at the currency scale, e.g. "12.50" AED, "0.00000001" BTC.
   * Unknown ids are missing from the map.
   */
  async getBalances(
    accountIds: readonly string[],
  ): Promise<Map<string, string>> {
    if (accountIds.length === 0) return new Map();
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: [...new Set(accountIds)] } },
      select: { id: true, balance: true, currency: true },
    });
    return new Map(
      accounts.map((a) => {
        assertCurrency(a.currency);
        return [a.id, Money.of(a.balance.toFixed(), a.currency).toString()];
      }),
    );
  }
}
