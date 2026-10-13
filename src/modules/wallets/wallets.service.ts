import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  Prisma,
  WalletStatus,
  type Wallet,
} from '../../generated/prisma/client.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { WalletPageDto } from './dto/wallet-page.dto.js';
import type { WalletDto } from './dto/wallet.dto.js';
import {
  walletClosed,
  walletLimitReached,
  walletNotFound,
} from './exceptions/wallet.exceptions.js';
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

export interface OpenWalletInput {
  currency: string;
  label?: string | null;
}

export interface WalletPageQuery {
  /** Id of the last wallet of the previous page */
  cursor?: string;
  limit: number;
}

const toDto = (wallet: WalletView, balance: string): WalletDto => ({
  id: wallet.id,
  currency: wallet.currency,
  label: wallet.label,
  status: wallet.status,
  balance,
  createdAt: wallet.createdAt.toISOString(),
  updatedAt: wallet.updatedAt.toISOString(),
});

@Injectable()
export class WalletsService {
  private readonly maxPerUser: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxPerUser = config.get('WALLETS_MAX_PER_USER', { infer: true });
  }

  /**
   * Opens the ledger account and the wallet in one transaction (POST /wallets). At most
   * WALLETS_MAX_PER_USER wallets that are not closed: an advisory lock per owner, held until
   * commit, makes concurrent opens of one owner count one after the other.
   */
  async open(ownerUserId: string, input: OpenWalletInput): Promise<WalletDto> {
    if (!isCurrency(input.currency))
      throw new UnsupportedCurrencyException(input.currency);
    const label = normalizeOptionalLabel(input.label);
    const currency = input.currency;
    const wallet = await this.prisma.withTx(async (tx) => {
      // $executeRaw: the lock returns `void`, which $queryRaw cannot deserialize
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext('wallet.open'), hashtext(${ownerUserId}))`;
      const open = await tx.wallet.count({
        where: { ownerUserId, status: { not: WalletStatus.closed } },
      });
      if (open >= this.maxPerUser) throw walletLimitReached(this.maxPerUser);
      const account = await this.ledger.openWalletAccount(currency, tx);
      return this.create(
        { ownerUserId, currency, ledgerAccountId: account.id, label },
        tx,
      );
    });
    return (await this.withBalances([wallet]))[0];
  }

  /** One owned wallet with its balance; WALLET_NOT_FOUND (404) otherwise. */
  async getOwned(id: string, ownerUserId: string): Promise<WalletDto> {
    const wallet = await this.findOwned(id, ownerUserId);
    if (!wallet) throw walletNotFound();
    return (await this.withBalances([wallet]))[0];
  }

  /** The owner's wallets in id order (UUID v7 = creation order), `limit` per page. */
  async listPage(
    ownerUserId: string,
    query: WalletPageQuery,
  ): Promise<WalletPageDto> {
    const rows = await this.prisma.wallet.findMany({
      where: {
        ownerUserId,
        ...(query.cursor ? { id: { gt: query.cursor } } : {}),
      },
      orderBy: { id: 'asc' },
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit).map(toView);
    return {
      items: await this.withBalances(page),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
    };
  }

  /** Renames an owned wallet and returns it with its balance (PATCH /wallets/:id). */
  async renameOwned(
    id: string,
    ownerUserId: string,
    label: string | null,
  ): Promise<WalletDto> {
    const wallet = await this.rename(id, ownerUserId, label);
    return (await this.withBalances([wallet]))[0];
  }

  private async withBalances(wallets: WalletView[]): Promise<WalletDto[]> {
    const balances = await this.ledger.getBalances(
      wallets.map((w) => w.ledgerAccountId),
    );
    return wallets.map((w) => {
      const balance = balances.get(w.ledgerAccountId);
      // Every wallet is created together with its account (open), so this is a data bug
      if (balance === undefined)
        throw new Error(`Ledger account of wallet ${w.id} not found`);
      return toDto(w, balance);
    });
  }

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
