import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DomainException } from '../../common/exceptions/domain.exception.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { IdempotentResponse } from '../../common/idempotency/interfaces/idempotent-response.interface.js';
import { InvalidAmountException } from '../../common/money/exceptions/invalid-amount.exception.js';
import { Money } from '../../common/money/money.js';
import { flattenValidationErrors } from '../../common/pipes/validation.pipe.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { AccountNotActiveException } from '../ledger/exceptions/account-not-active.exception.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { PaymentSucceededDataDto } from './dto/payment-succeeded-data.dto.js';
import { WebhookEventDto } from './dto/webhook-event.dto.js';
import type {
  DepositRejectionCode,
  WebhookDepositDto,
  WebhookReceiptDto,
} from './dto/webhook-receipt.dto.js';
import {
  depositsUnavailable,
  invalidWebhookEvent,
} from './exceptions/webhook.exceptions.js';
import type { WebhookProvider } from './webhook-providers.js';

export const PAYMENT_SUCCEEDED = 'payment.succeeded';

/** Ledger ref of a deposit: the postings PK is a second guard against crediting an event twice. */
export const depositRef = (provider: WebhookProvider, eventId: string) =>
  `webhook:${provider}:${eventId}`;

/** Counter side of a provider's deposits; goes negative by the total the provider paid in. */
export const clearingAccountCode = (
  provider: WebhookProvider,
  currency: string,
) => `clearing:${provider}:${currency.toLowerCase()}`;

const notActiveCode = (status: string): DepositRejectionCode =>
  status === 'closed' ? 'ACCOUNT_CLOSED' : 'ACCOUNT_FROZEN';

interface Deposit {
  walletId: string;
  amount: Money;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
  ) {}

  /**
   * Called after WebhookSignatureGuard, so `body` is exactly what the provider signed. One
   * runOnce per (provider, event id) (2.17): the first delivery credits the wallet against the
   * provider's clearing account, or stores why it cannot; every redelivery, also a concurrent
   * one, replays that receipt. The same event id with another body is 422 IDEMPOTENCY_KEY_REUSED.
   */
  async receive(
    provider: WebhookProvider,
    body: unknown,
  ): Promise<IdempotentResponse<WebhookReceiptDto>> {
    const event = this.parseEvent(body);
    const deposit =
      event.type === PAYMENT_SUCCEEDED
        ? this.parseDeposit(event.data)
        : undefined;
    return this.idempotency.runOnce(
      `webhook:${provider}`,
      event.id,
      body,
      (tx) => this.process(tx, provider, event, deposit),
    );
  }

  /** Checks only the fields this service reads; the provider's other fields are kept as sent. */
  parseEvent(body: unknown): WebhookEventDto {
    if (typeof body !== 'object' || body === null || Array.isArray(body))
      throw invalidWebhookEvent([
        { field: 'body', issue: 'must be a JSON object' },
      ]);
    return validated(WebhookEventDto, body);
  }

  parseDeposit(data: Record<string, unknown>): Deposit {
    const dto = validated(PaymentSucceededDataDto, data, 'data');
    try {
      return {
        walletId: dto.walletId,
        amount: Money.of(dto.amount, dto.currency),
      };
    } catch (e) {
      if (e instanceof InvalidAmountException)
        throw invalidWebhookEvent([{ field: 'data.amount', issue: e.message }]);
      throw e;
    }
  }

  private async process(
    tx: Prisma.TransactionClient,
    provider: WebhookProvider,
    event: WebhookEventDto,
    deposit: Deposit | undefined,
  ): Promise<WebhookReceiptDto> {
    const base = { provider, eventId: event.id, type: event.type };
    if (!deposit) return { ...base, status: 'ignored' };

    const { amount } = deposit;
    const requested: WebhookDepositDto = {
      walletId: deposit.walletId,
      amount: amount.toString(),
      currency: amount.currency,
    };
    const rejected = (
      code: DepositRejectionCode,
      message: string,
    ): WebhookReceiptDto => ({
      ...base,
      status: 'rejected',
      deposit: requested,
      reason: { code, message },
    });

    const wallet = await this.wallets.findById(deposit.walletId, tx);
    if (!wallet)
      return rejected('WALLET_NOT_FOUND', 'No wallet with this id exists.');
    if (wallet.currency !== amount.currency)
      return rejected(
        'CURRENCY_MISMATCH',
        `The wallet holds ${wallet.currency}, not ${amount.currency}.`,
      );
    if (wallet.status !== 'active')
      return rejected(
        notActiveCode(wallet.status),
        `The wallet is ${wallet.status}.`,
      );

    const clearing = await this.ledger.ensureSystemAccount(
      {
        code: clearingAccountCode(provider, amount.currency),
        currency: amount.currency,
        allowNegative: true,
      },
      tx,
    );
    // post writes the posting row before it checks the accounts, so a rejection found there
    // rolls back to here and the stored receipt commits without a half posting
    await tx.$executeRaw`SAVEPOINT webhook_deposit`;
    try {
      await this.ledger.post(
        {
          ref: depositRef(provider, event.id),
          entries: [
            { accountId: clearing.id, amount: amount.negate().toString() },
            { accountId: wallet.ledgerAccountId, amount: amount.toString() },
          ],
        },
        tx,
      );
    } catch (e) {
      if (e instanceof AccountNotActiveException) {
        if (e.accountId !== wallet.ledgerAccountId) throw depositsUnavailable();
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT webhook_deposit`;
        return rejected(notActiveCode(e.status), `The wallet is ${e.status}.`);
      }
      // Credited before and its idempotency key purged (older than 30 days)
      if (e instanceof DomainException && e.code === 'POSTING_EXISTS') {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT webhook_deposit`;
        return { ...base, status: 'credited', deposit: requested };
      }
      throw e;
    }
    return { ...base, status: 'credited', deposit: requested };
  }
}

function validated<T extends object>(
  cls: new () => T,
  plain: object,
  parent = '',
): T {
  const value = plainToInstance(cls, plain);
  const errors = validateSync(value, {
    validationError: { target: false, value: false },
  });
  if (errors.length)
    throw invalidWebhookEvent(flattenValidationErrors(errors, parent));
  return value;
}
