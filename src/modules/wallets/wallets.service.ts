import { Injectable } from '@nestjs/common';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type Wallet } from '../../generated/prisma/client.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';

export type WalletView = Omit<Wallet, 'currency'> & { currency: Currency };

export interface CreateWalletInput {
  ownerUserId: string;
  currency: string;
  /** ledger.accounts.id of the account holding this wallet's balance (no FK across schemas) */
  ledgerAccountId: string;
}

const toView = (wallet: Wallet) => wallet as WalletView;

@Injectable()
export class WalletsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates the wallet row only. The caller creates the ledger account and passes `tx`,
   * so wallet and account commit together. An owner may hold several wallets per currency;
   * a ledger account backs one wallet only (unique index, a violation is a caller bug).
   */
  async create(
    input: CreateWalletInput,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<WalletView> {
    if (!isCurrency(input.currency))
      throw new UnsupportedCurrencyException(input.currency);
    return toView(
      await tx.wallet.create({
        data: {
          ownerUserId: input.ownerUserId,
          currency: input.currency,
          ledgerAccountId: input.ledgerAccountId,
        },
      }),
    );
  }

  async findById(id: string): Promise<WalletView | null> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id } });
    return wallet && toView(wallet);
  }

  /** The wallet only when `ownerUserId` owns it, so callers answer 404 for other users' wallets. */
  async findOwned(id: string, ownerUserId: string): Promise<WalletView | null> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id, ownerUserId },
    });
    return wallet && toView(wallet);
  }

  async listByOwner(ownerUserId: string): Promise<WalletView[]> {
    const wallets = await this.prisma.wallet.findMany({
      where: { ownerUserId },
      orderBy: { id: 'asc' },
    });
    return wallets.map(toView);
  }
}
