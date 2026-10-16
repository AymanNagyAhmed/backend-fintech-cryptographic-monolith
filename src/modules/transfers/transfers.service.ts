import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { IdempotentResponse } from '../../common/idempotency/interfaces/idempotent-response.interface.js';
import {
  CURRENCIES,
  isCurrency,
  type Currency,
} from '../../common/money/currency.js';
import { UnsupportedCurrencyException } from '../../common/money/exceptions/unsupported-currency.exception.js';
import { Money } from '../../common/money/money.js';
import type { EnvironmentVariables } from '../../config/env.validation.js';
import type { Prisma, Transfer } from '../../generated/prisma/client.js';
import { sumTransfersOutToday } from '../../generated/prisma/sql.js';
import { getRequestId } from '../../common/request-context.js';
import { AccountNotActiveException } from '../ledger/exceptions/account-not-active.exception.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { OutboxService } from '../outbox/outbox.service.js';
import { auditPartitionKey } from '../../shared-kernel/audit/audit-partition-key.js';
import type { WalletView } from '../wallets/wallets.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import type { CreateTransferDto } from './dto/create-transfer.dto.js';
import type { TransferDto } from './dto/transfer.dto.js';
import {
  dailyLimitExceeded,
  sameWalletTransfer,
  transferAccountNotActive,
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

const assertActive = (
  wallet: WalletView,
  field: 'fromWalletId' | 'toWalletId',
) => {
  if (wallet.status !== 'active')
    throw transferAccountNotActive(field, wallet.status);
};

@Injectable()
export class TransfersService {
  private readonly dailyLimits: Record<Currency, Money>;
  private readonly partitionCount: number;

  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
    private readonly outbox: OutboxService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.dailyLimits = Object.fromEntries(
      CURRENCIES.map((c) => [
        c,
        Money.of(
          config.get(`TRANSFER_DAILY_LIMIT_${c}` as const, { infer: true }),
          c,
        ),
      ]),
    ) as Record<Currency, Money>;
    this.partitionCount = config.get('AUDIT_PARTITION_COUNT', { infer: true });
  }

  /**
   * POST /transfers. Keys are scoped per caller, so two users' keys never meet. Claim, posting
   * (locks, funds check, entries, balances), daily limit, transfer row, ledger.outbox row and
   * stored response commit in one transaction: a retry with the same key replays the 201, a
   * failed attempt leaves nothing (A-B6.4 / A-B9.3).
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
    assertActive(from, 'fromWalletId');
    assertActive(to, 'toWalletId');

    const ref = `transfer:${randomUUID()}`;
    try {
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
    } catch (e) {
      // Ledger account ids stay internal: answer with the wallet field instead
      if (e instanceof AccountNotActiveException)
        throw transferAccountNotActive(
          e.accountId === from.ledgerAccountId ? 'fromWalletId' : 'toWalletId',
          e.status,
        );
      throw e;
    }
    // After post: it holds the source account lock until commit, so the sum counts every
    // committed transfer of this account and concurrent ones wait their turn
    await this.assertWithinDailyLimit(tx, from.ledgerAccountId, amount);

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
    const dtoOut = toDto(row, amount.currency);
    const requestId = getRequestId();
    await this.outbox.enqueue(tx, 'ledger', {
      type: 'transfer.completed',
      schemaVersion: 1,
      occurredAt: dtoOut.createdAt,
      actor: { subjectRef: userId },
      ...(requestId !== undefined ? { requestId } : {}),
      partitionKey: auditPartitionKey(row.id, this.partitionCount),
      transferId: row.id,
      sourceWalletId: from.id,
      destinationWalletId: to.id,
      currency: amount.currency,
      amount: amount.toString(),
    });
    return dtoOut;
  }

  private async assertWithinDailyLimit(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: Money,
  ): Promise<void> {
    const [{ total }] = await tx.$queryRawTyped(
      sumTransfersOutToday(accountId),
    );
    const sentToday = Money.of(total ?? '0', amount.currency);
    const limit = this.dailyLimits[amount.currency];
    if (sentToday.add(amount).gt(limit))
      throw dailyLimitExceeded(limit, sentToday);
  }
}
