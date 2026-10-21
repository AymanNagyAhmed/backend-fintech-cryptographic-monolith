import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import type { IdempotentResponse } from '../../common/idempotency/interfaces/idempotent-response.interface.js';
import { isCurrency } from '../../common/money/currency.js';
import { Money } from '../../common/money/money.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TotpService } from '../auth/totp/totp.service.js';
import { AccountNotActiveException } from '../ledger/exceptions/account-not-active.exception.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletsService } from '../wallets/wallets.service.js';
import { BeneficiariesService } from './beneficiaries.service.js';
import type { CreateWithdrawalDto } from './dto/create-withdrawal.dto.js';
import type { WithdrawalDto } from './dto/withdrawal.dto.js';
import {
  invalidTotp,
  unsupportedCurrency,
  withdrawalCurrencyMismatch,
  withdrawalWalletNotActive,
  withdrawalWalletNotFound,
} from './exceptions/withdrawal.exceptions.js';

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly beneficiaries: BeneficiariesService,
    private readonly totp: TotpService,
    private readonly idempotency: IdempotencyService,
    private readonly ledger: LedgerService,
    private readonly wallets: WalletsService,
  ) {}

  /** Ensures the destination is on the allow-list and past the activation delay. */
  requireActiveBeneficiary(ownerUserId: string, beneficiaryId: string) {
    return this.beneficiaries.requireActive(ownerUserId, beneficiaryId);
  }

  /**
   * Move funds to an active beneficiary. TOTP is checked on every call, including
   * when the destination is already active. A missing or wrong code throws before
   * any ledger write.
   */
  payout(
    userId: string,
    idempotencyKey: string,
    dto: CreateWithdrawalDto,
  ): Promise<IdempotentResponse<WithdrawalDto>> {
    return this.idempotency.runOnce(
      `withdrawal:${userId}`,
      idempotencyKey,
      dto,
      (tx) => this.execute(tx, userId, dto),
      { statusCode: HttpStatus.CREATED },
    );
  }

  private async execute(
    tx: Prisma.TransactionClient,
    userId: string,
    dto: CreateWithdrawalDto,
  ): Promise<WithdrawalDto> {
    if (!isCurrency(dto.currency)) throw unsupportedCurrency(dto.currency);
    const amount = Money.of(dto.amount, dto.currency);
    if (!(await this.totp.verify(userId, dto.totpCode))) throw invalidTotp();

    const beneficiary = await this.beneficiaries.requireActive(
      userId,
      dto.beneficiaryId,
    );
    if (beneficiary.currency !== amount.currency)
      throw withdrawalCurrencyMismatch();

    const wallet = await this.wallets.findOwned(dto.walletId, userId, tx);
    if (!wallet) throw withdrawalWalletNotFound();
    if (wallet.currency !== amount.currency) throw withdrawalCurrencyMismatch();
    if (wallet.status !== 'active')
      throw withdrawalWalletNotActive(wallet.status);

    const clearing = await this.ledger.ensureSystemAccount(
      {
        code: `withdrawal:${amount.currency.toLowerCase()}`,
        currency: amount.currency,
        allowNegative: true,
      },
      tx,
    );
    const ref = `withdrawal:${randomUUID()}`;
    try {
      await this.ledger.post(
        {
          ref,
          entries: [
            {
              accountId: wallet.ledgerAccountId,
              amount: amount.negate().toString(),
            },
            { accountId: clearing.id, amount: amount.toString() },
          ],
        },
        tx,
      );
    } catch (e) {
      if (
        e instanceof AccountNotActiveException &&
        e.accountId === wallet.ledgerAccountId
      )
        throw withdrawalWalletNotActive(e.status);
      throw e;
    }

    return {
      id: ref,
      walletId: wallet.id,
      beneficiaryId: beneficiary.id,
      amount: amount.toString(),
      currency: amount.currency,
      status: 'COMPLETED',
    };
  }
}
