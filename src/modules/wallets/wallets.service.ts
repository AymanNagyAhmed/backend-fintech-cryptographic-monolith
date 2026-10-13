import { Injectable } from '@nestjs/common';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type Wallet } from '../../generated/prisma/client.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { walletClosed, walletNotFound } from './exceptions/wallet.exceptions.js';
import { normalizeWalletLabel } from './wallet-label.js';

export type WalletView = Omit<Wallet, 'currency'> & { currency: Currency };

export interface CreateWalletInput {
  ownerUserId: string;
  currency: string;
  /** ledger.accounts.id of the account holding this wallet's balance (no FK across schemas) */
  ledgerAccountId: string;
  /** User-written; trimmed and checked by normalizeWalletLabel. Omitted or null = no label. */
  label?: string | null;
}

const RECORD_NOT_FOUND = 'P2025';

const toView = (wallet: Wallet) => wallet as WalletView;

const normalizeOptionalLabel = (label: string | null | undefined) =>
  label == null ? null : normalizeWalletLabel(label);

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
    const label = normalizeOptionalLabel(input.label);
    return toView(
      await tx.wallet.create({
        data: {
          ownerUserId: input.ownerUserId,
          currency: input.currency,
          ledgerAccountId: input.ledgerAccountId,
          label,
        },
      }),
    );
  }

  /**
   * Sets or (with `null`) clears the label. Another user's wallet is WALLET_NOT_FOUND (404),
   * a closed wallet WALLET_CLOSED (409). The status filter is part of the UPDATE, so a wallet
   * closed concurrently is not renamed (the guard trigger would reject it anyway).
   */
  async rename(
    id: string,
    ownerUserId: string,
    label: string | null,
    tx: Prisma.TransactionClient = this.prisma,
  ): Promise<WalletView> {
    const next = normalizeOptionalLabel(label);
    try {
      return toView(
        await tx.wallet.update({
          where: { id, ownerUserId, status: { not: 'closed' } },
          data: { label: next },
        }),
      );
    } catch (e) {
      if (
        !(e instanceof Prisma.PrismaClientKnownRequestError) ||
        e.code !== RECORD_NOT_FOUND
      )
        throw e;
    }
    const owned = await tx.wallet.findFirst({
      where: { id, ownerUserId },
      select: { id: true },
    });
    throw owned ? walletClosed() : walletNotFound();
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
