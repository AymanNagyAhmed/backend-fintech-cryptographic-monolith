import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { IdempotentResponse } from '../../common/idempotency/interfaces/idempotent-response.interface.js';
import { isCurrency, type Currency } from '../../common/money/currency.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { Money } from '../../common/money/money.js';
import type { Prisma, Transfer } from '../../generated/prisma/client.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
import type { TransferDto } from './dto/transfer.dto.js';
import {
  sameWalletTransfer,
  transferCurrencyMismatch,
  transferWalletNotFound,
} from './exceptions/transfer.exceptions.js';

const toDto = (row: Transfer, currency: Currency): TransferDto => ({
  id: row.id,
  fromWalletId: row.fromWalletId,
  toWalletId: row.toWalletId,
  // Prisma's Decimal is not the decimal.js instance Money accepts, so pass a plain string
  amount: Money.of(row.amount.toFixed(), currency).toString(),
  currency,
  status: 'COMPLETED',
  createdAt: row.createdAt.toISOString(),
});

@Injectable()
export class TransfersService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
  ) {}

  /**
   * POST /transfers. Keys are scoped per caller, so two users' keys never meet. Claim, posting
   * (locks, funds check, entries, balances), transfer row and stored response commit in one
   * transaction: a retry with the same key replays the 201, a failed attempt leaves nothing.
   */
  create(
    userId: string,
    idempotencyKey: string,
    dto: CreateTransferDto,
  ): Promise<IdempotentResponse<TransferDto>> {
    return this.idempotency.runOnce(
      `transfer:${userId}`,
      idempotencyKey,
      dto,
      (tx) => this.execute(tx, userId, dto),
      { statusCode: HttpStatus.CREATED },
    );
  }

  private async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateTransferDto,
  ): Promise<TransferDto> {
    if (dto.fromWalletId === dto.toWalletId) throw sameWalletTransfer();
    if (!isCurrency(dto.currency))
      throw new UnsupportedCurrencyException(dto.currency);
    const amount = Money.of(dto.amount, dto.currency);

    const from = await this.wallets.findOwned(dto.fromWalletId, userId, tx);
    if (!from) throw transferWalletNotFound('fromWalletId');
    const to = await this.wallets.findById(dto.toWalletId, tx);
    if (!to) throw transferWalletNotFound('toWalletId');
    if (from.currency !== amount.currency)
      throw transferCurrencyMismatch('fromWalletId', from.currency);
    if (to.currency !== amount.currency)
      throw transferCurrencyMismatch('toWalletId', to.currency);

    const ref = `transfer:${randomUUID()}`;
    await this.ledger.post(
      {
        ref,
        entries: [
          {
            accountId: from.ledgerAccountId,
            amount: amount.negate().toString(),
          },
          { accountId: to.ledgerAccountId, amount: amount.toString() },
        ],
      },
      tx,
    );
    const row = await tx.transfer.create({
      data: {
        ref,
        fromAccountId: from.ledgerAccountId,
        toAccountId: to.ledgerAccountId,
        fromWalletId: from.id,
        toWalletId: to.id,
        amount: amount.toString(),
        currency: amount.currency,
        initiatorUserId: userId,
      },
    });
    return toDto(row, amount.currency);
  }
}
